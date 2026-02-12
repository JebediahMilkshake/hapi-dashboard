/**
 * HAPi Dashboard — Client-side JavaScript
 *
 * Replaces the Flask backend proxy.  All Home Assistant API calls go
 * directly from the browser using the long-lived access token stored
 * in the global CONFIG object (loaded from config.js before this script).
 *
 * Globals expected:
 *   CONFIG  — configuration object (see config.js)
 *   lucide  — Lucide icon library loaded from CDN
 */

/* ================================================================== *
 *  1. HA API Helper
 * ================================================================== */

/**
 * Fetch data from the Home Assistant REST API.
 *
 * @param {string}  endpoint  API path after "/api/" (e.g. "states/weather.forecast_home")
 * @param {string}  [method]  HTTP method — "GET" (default) or "POST"
 * @param {Object}  [body]    For GET: appended as query params.  For POST: JSON body.
 * @returns {Promise<Object|null>}  Parsed JSON response, or null on failure.
 */
function haFetch(endpoint, method, body) {
    method = method || 'GET';

    var url = CONFIG.HA_URL + '/api/' + endpoint;
    var headers = {
        'Authorization': 'Bearer ' + CONFIG.HA_TOKEN,
        'Content-Type': 'application/json'
    };

    var options = {
        method: method,
        headers: headers
    };

    if (method === 'POST') {
        if (body) {
            options.body = JSON.stringify(body);
        }
    } else if (body) {
        // GET — append body keys as query parameters
        var params = new URLSearchParams();
        var keys = Object.keys(body);
        for (var i = 0; i < keys.length; i++) {
            params.append(keys[i], body[keys[i]]);
        }
        url += (url.indexOf('?') === -1 ? '?' : '&') + params.toString();
    }

    // AbortController for 5-second timeout
    var controller = new AbortController();
    options.signal = controller.signal;
    var timeoutId = setTimeout(function () { controller.abort(); }, 5000);

    return fetch(url, options)
        .then(function (response) {
            clearTimeout(timeoutId);
            if (response.ok) {
                return response.json();
            }
            console.warn('HA API returned ' + response.status + ': ' + endpoint);
            return null;
        })
        .catch(function (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                console.error('HA API timeout: ' + endpoint);
            } else {
                console.error('HA API error: ' + endpoint + ' — ' + err);
            }
            return null;
        });
}

/* ================================================================== *
 *  2. Client-side Cache
 * ================================================================== */

var cache = {
    weather:  { data: null, timestamp: null },
    theme:    { data: null, timestamp: null },
    forecast: { data: null, timestamp: null },
    shopping: { data: null, timestamp: null }
};

/**
 * Returns true when cached data for `key` is still within its TTL.
 */
function isCacheValid(key) {
    if (cache[key].data === null || cache[key].timestamp === null) {
        return false;
    }
    var age = (Date.now() - cache[key].timestamp) / 1000; // seconds
    return age < CONFIG.CACHE_DURATION[key];
}

/* ================================================================== *
 *  3. Data Fetching Functions
 * ================================================================== */

/**
 * Fetch current weather state.  Cached for CONFIG.CACHE_DURATION.weather seconds.
 */
function fetchWeather() {
    if (isCacheValid('weather')) {
        return Promise.resolve(cache.weather.data);
    }
    return haFetch('states/' + CONFIG.WEATHER_ENTITY).then(function (data) {
        if (data) {
            cache.weather.data = data;
            cache.weather.timestamp = Date.now();
        }
        return data;
    });
}

/**
 * Fetch theme toggle state.  Returns a boolean (true = dark mode).
 * Cached for CONFIG.CACHE_DURATION.theme seconds.
 */
function fetchTheme() {
    if (isCacheValid('theme')) {
        return Promise.resolve(cache.theme.data);
    }
    return haFetch('states/' + CONFIG.THEME_ENTITY).then(function (data) {
        var isDark = data ? data.state === 'on' : true;
        cache.theme.data = isDark;
        cache.theme.timestamp = Date.now();
        return isDark;
    });
}

/**
 * Fetch the 5-day daily forecast via the HA service call.
 * Cached for CONFIG.CACHE_DURATION.forecast seconds.
 */
function fetchForecast() {
    if (isCacheValid('forecast')) {
        return Promise.resolve(cache.forecast.data);
    }
    return haFetch(
        'services/weather/get_forecasts?return_response',
        'POST',
        { entity_id: CONFIG.WEATHER_ENTITY, type: 'daily' }
    ).then(function (resp) {
        var forecasts = [];
        if (resp) {
            try {
                forecasts = resp.service_response[CONFIG.WEATHER_ENTITY].forecast.slice(0, 5);
            } catch (e) {
                console.error('Forecast parse error:', e);
            }
        }
        cache.forecast.data = forecasts;
        cache.forecast.timestamp = Date.now();
        return forecasts;
    });
}

/**
 * Fetch calendar events for all configured calendars.
 * Events are always fetched fresh (no cache) because they change frequently.
 *
 * @param {boolean} isDark  Current theme — selects color_dark or color_light.
 * @returns {Promise<Array>}  Flat array of event objects with color & priority attached.
 */
function fetchCalendarEvents(isDark) {
    var now = new Date();
    var start = new Date(now);
    start.setDate(now.getDate() - 3);
    var end = new Date(now);
    end.setDate(now.getDate() + 14);

    var startISO = start.toISOString();
    var endISO = end.toISOString();

    var promises = [];
    for (var i = 0; i < CONFIG.CALENDARS.length; i++) {
        (function (cal) {
            var p = haFetch('calendars/' + cal.entity, 'GET', { start: startISO, end: endISO })
                .then(function (events) {
                    if (!events) return [];
                    var color = isDark ? cal.color_dark : cal.color_light;
                    var priority = cal.priority !== undefined ? cal.priority : 99;
                    for (var j = 0; j < events.length; j++) {
                        events[j].color = color;
                        events[j].priority = priority;
                    }
                    return events;
                })
                .catch(function (err) {
                    console.error('Error fetching calendar ' + cal.entity + ':', err);
                    return [];
                });
            promises.push(p);
        })(CONFIG.CALENDARS[i]);
    }

    return Promise.all(promises).then(function (arrays) {
        var result = [];
        for (var i = 0; i < arrays.length; i++) {
            for (var j = 0; j < arrays[i].length; j++) {
                result.push(arrays[i][j]);
            }
        }
        return result;
    });
}

/**
 * Fetch the shopping / todo list items.
 * Cached for CONFIG.CACHE_DURATION.shopping seconds.
 *
 * @returns {Promise<Array>}  Array of {name, status} sorted with pending first.
 */
function fetchShoppingItems() {
    if (isCacheValid('shopping')) {
        return Promise.resolve(cache.shopping.data);
    }
    return haFetch(
        'services/todo/get_items?return_response',
        'POST',
        { entity_id: CONFIG.SHOPPING_LIST_ENTITY }
    ).then(function (resp) {
        var items = [];
        if (resp) {
            try {
                items = resp.service_response[CONFIG.SHOPPING_LIST_ENTITY].items;
            } catch (e) {
                console.error('Shopping list parse error:', e);
            }
        }
        var normalised = [];
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it.summary) {
                normalised.push({
                    name: it.summary,
                    status: it.status || 'needs_action'
                });
            }
        }
        // Pending items first, completed last
        normalised.sort(function (a, b) {
            var aVal = a.status === 'needs_action' ? 0 : 1;
            var bVal = b.status === 'needs_action' ? 0 : 1;
            return aVal - bVal;
        });
        cache.shopping.data = normalised;
        cache.shopping.timestamp = Date.now();
        return normalised;
    });
}

/* ================================================================== *
 *  4. Shopping List Categorisation
 * ================================================================== */

/**
 * Group a flat list of {name, status} items into categorised buckets
 * using CONFIG.GROCERY_CATEGORIES keyword matching (case-insensitive
 * substring match, first match wins, unmatched -> "Other").
 *
 * Returns an array of {category, items} in GROCERY_CATEGORY_ORDER order,
 * with any unknown categories appended alphabetically and "Other" always last.
 */
function groupShoppingItems(items) {
    var buckets = {}; // category -> [{name, status}, ...]

    for (var i = 0; i < items.length; i++) {
        var nameLower = items[i].name.toLowerCase();
        var matched = false;
        var cat = 'Other';

        for (var r = 0; r < CONFIG.GROCERY_CATEGORIES.length; r++) {
            var rule = CONFIG.GROCERY_CATEGORIES[r];
            for (var k = 0; k < rule.keywords.length; k++) {
                if (nameLower.indexOf(rule.keywords[k]) !== -1) {
                    cat = rule.category;
                    matched = true;
                    break;
                }
            }
            if (matched) break;
        }

        if (!buckets[cat]) {
            buckets[cat] = [];
        }
        buckets[cat].push(items[i]);
    }

    // Build ordered output: GROCERY_CATEGORY_ORDER first, extras alphabetically, "Other" last
    var orderedCats = [];
    var seen = {};

    for (var o = 0; o < CONFIG.GROCERY_CATEGORY_ORDER.length; o++) {
        var c = CONFIG.GROCERY_CATEGORY_ORDER[o];
        if (buckets[c]) {
            orderedCats.push(c);
            seen[c] = true;
        }
    }

    // Extras: categories in buckets not in the predefined order (except "Other")
    var extras = [];
    var bucketKeys = Object.keys(buckets);
    for (var e = 0; e < bucketKeys.length; e++) {
        if (!seen[bucketKeys[e]] && bucketKeys[e] !== 'Other') {
            extras.push(bucketKeys[e]);
        }
    }
    extras.sort();
    for (var x = 0; x < extras.length; x++) {
        orderedCats.push(extras[x]);
    }

    if (buckets['Other']) {
        orderedCats.push('Other');
    }

    var result = [];
    for (var g = 0; g < orderedCats.length; g++) {
        result.push({ category: orderedCats[g], items: buckets[orderedCats[g]] });
    }
    return result;
}

/* ================================================================== *
 *  5. Rendering / DOM Helper Functions
 * ================================================================== */

// Cache DOM element references (looked up once at load time)
var connectionWarning = document.getElementById('connection-warning');
var weatherMainIcon   = document.getElementById('weather-main-icon');
var weatherTemp       = document.getElementById('weather-temp');
var weatherCondition  = document.getElementById('weather-condition');
var forecastGrid      = document.getElementById('forecast-grid');
var eventList         = document.getElementById('event-list');
var groceryList       = document.getElementById('grocery-list');
var dockedLegend      = document.getElementById('docked-legend');
var calendarGrid      = document.getElementById('grid');
var monthHeader       = document.getElementById('month-header');

/**
 * Update the clock and date display (12-hour format with ordinal suffix).
 */
function updateClock() {
    var now = new Date();
    var hours = now.getHours();
    var mins = String(now.getMinutes()).padStart(2, '0');
    var ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;

    document.getElementById('clock-time').textContent = hours + ':' + mins;
    document.getElementById('clock-ampm').textContent = ampm;

    var dayName = now.toLocaleDateString([], { weekday: 'short' });
    var monthName = now.toLocaleDateString([], { month: 'long' });
    var dateNum = now.getDate();
    document.getElementById('digital-date').textContent =
        dayName + ' ' + monthName + ' ' + dateNum + getOrdinal(dateNum);
}

/**
 * Return the English ordinal suffix for a day-of-month number.
 */
function getOrdinal(d) {
    if (d > 3 && d < 21) return 'th';
    switch (d % 10) {
        case 1:  return 'st';
        case 2:  return 'nd';
        case 3:  return 'rd';
        default: return 'th';
    }
}

/**
 * Return a YYYY-MM-DD string for a Date object in local time.
 */
function getLocalDateStr(dateObj) {
    var y = dateObj.getFullYear();
    var m = String(dateObj.getMonth() + 1).padStart(2, '0');
    var d = String(dateObj.getDate()).padStart(2, '0');
    return y + '-' + m + '-' + d;
}

/**
 * Map a Home Assistant weather condition string to a Lucide icon HTML string.
 *
 * @param {string} condition  HA weather condition (e.g. "sunny", "partlycloudy")
 * @param {string} [sizeClass]  Optional CSS class for the icon element
 * @returns {string}  HTML string with a <i data-lucide="..."> element
 */
function getWeatherIcon(condition, sizeClass) {
    if (!condition) return '<i data-lucide="help-circle"></i>';
    sizeClass = sizeClass || '';
    var iconMap = {
        'sunny':          'sun',
        'clearnight':     'moon',
        'cloudy':         'cloud',
        'fog':            'cloud-fog',
        'hail':           'cloud-hail',
        'lightning':      'zap',
        'lightningrain':  'cloud-lightning',
        'partlycloudy':   'cloud-sun',
        'pouring':        'cloud-rain-wind',
        'rainy':          'cloud-rain',
        'snowy':          'cloud-snow',
        'snowyrainy':     'cloud-snow',
        'windy':          'wind'
    };
    var key = condition.toLowerCase().replace(/-/g, '');
    var iconName = iconMap[key] || 'help-circle';
    return '<i data-lucide="' + iconName + '" class="' + sizeClass + '"></i>';
}

/**
 * Sort events: timed events by dateTime ascending, all-day events by priority.
 * Returns a new array (timed first, then all-day).
 */
function sortEvents(events) {
    var timed = [];
    var allDay = [];
    for (var i = 0; i < events.length; i++) {
        if (events[i].start.dateTime) {
            timed.push(events[i]);
        } else if (events[i].start.date) {
            allDay.push(events[i]);
        }
    }
    timed.sort(function (a, b) {
        return new Date(a.start.dateTime) - new Date(b.start.dateTime);
    });
    allDay.sort(function (a, b) {
        return (a.priority || 99) - (b.priority || 99);
    });
    return timed.concat(allDay);
}

/**
 * Render the grouped shopping list into #grocery-list.
 * Uses DocumentFragment for a single reflow and textContent for safety/speed.
 *
 * @param {Array} grouped  Array of {category, items:[{name,status}]}
 */
function renderShoppingList(grouped) {
    var fragment = document.createDocumentFragment();

    if (!grouped || grouped.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'event-item no-events';
        empty.style.borderLeftColor = 'var(--border)';
        empty.textContent = 'List is empty';
        fragment.appendChild(empty);
    } else {
        for (var g = 0; g < grouped.length; g++) {
            var group = grouped[g];

            var header = document.createElement('div');
            header.className = 'grocery-category-header';
            header.textContent = group.category.toUpperCase();
            fragment.appendChild(header);

            for (var i = 0; i < group.items.length; i++) {
                var item = group.items[i];
                var isDone = item.status === 'completed';

                var row = document.createElement('div');
                row.className = 'shopping-item' + (isDone ? ' done' : '');
                row.setAttribute('role', 'listitem');

                var dot = document.createElement('span');
                dot.className = 'shopping-item-dot';
                dot.setAttribute('aria-hidden', 'true');

                var name = document.createElement('span');
                name.className = 'shopping-item-name';
                name.textContent = item.name;

                row.appendChild(dot);
                row.appendChild(name);
                fragment.appendChild(row);
            }
        }
    }

    groceryList.innerHTML = '';
    groceryList.appendChild(fragment);
}

/* ================================================================== *
 *  5b. Main Dashboard Update
 * ================================================================== */

/**
 * Fetch all dashboard data (theme, weather, forecast, calendar events)
 * and update the entire DOM.  Called once on load, then every 60 seconds.
 */
function updateDashboard() {
    // Fetch theme first — the result determines calendar event colours.
    fetchTheme().then(function (isDark) {
        // Apply theme class
        document.body.className = isDark ? '' : 'light-theme';

        // Build legend data from CONFIG.CALENDARS and current theme
        var legendData = [];
        for (var i = 0; i < CONFIG.CALENDARS.length; i++) {
            var cal = CONFIG.CALENDARS[i];
            legendData.push({
                name: cal.name,
                color: isDark ? cal.color_dark : cal.color_light
            });
        }

        // Fetch weather, forecast, and calendar events in parallel
        return Promise.all([
            fetchWeather(),
            fetchForecast(),
            fetchCalendarEvents(isDark)
        ]).then(function (results) {
            var weather = results[0];
            var forecast = results[1];
            var events = results[2];

            // Hide connection warning on success
            connectionWarning.classList.add('hidden');

            // ── Weather ───────────────────────────────────────────
            if (weather) {
                weatherMainIcon.innerHTML = getWeatherIcon(weather.state, 'large-icon');
                weatherTemp.textContent = Math.round(weather.attributes.temperature) + '\u00B0';
                weatherCondition.textContent = weather.state.toUpperCase().replace(/-/g, ' ');
            }

            // ── Forecast ──────────────────────────────────────────
            var forecastFragment = document.createDocumentFragment();
            if (forecast) {
                for (var fi = 0; fi < forecast.length; fi++) {
                    var day = forecast[fi];
                    var hi = Math.round(day.temperature);
                    var lo = day.templow != null ? Math.round(day.templow) : null;
                    var precip = day.precipitation_probability;
                    var dayLabel;
                    if (fi === 0) {
                        dayLabel = 'TODAY';
                    } else if (fi === 1) {
                        dayLabel = 'TMRW';
                    } else {
                        dayLabel = new Date(day.datetime).toLocaleDateString([], { weekday: 'short' }).toUpperCase();
                    }

                    var fDiv = document.createElement('div');
                    fDiv.className = 'forecast-day';
                    var html = '<div class="f-name">' + dayLabel + '</div>' +
                        '<div class="f-icon">' + getWeatherIcon(day.condition) + '</div>' +
                        '<div class="f-temp"><span class="f-hi">' + hi + '\u00B0</span>' +
                        (lo != null ? '<span class="f-lo">' + lo + '\u00B0</span>' : '') +
                        '</div>';
                    if (precip != null) {
                        html += '<div class="f-precip">' + precip + '%</div>';
                    }
                    fDiv.innerHTML = html;
                    forecastFragment.appendChild(fDiv);
                }
            }
            forecastGrid.innerHTML = '';
            forecastGrid.appendChild(forecastFragment);
            lucide.createIcons({ container: forecastGrid });

            // ── Planner (Sidebar Event List) ──────────────────────
            var plannerFragment = document.createDocumentFragment();
            var now = new Date();
            var todayStr = getLocalDateStr(now);
            var plannerDays = (CONFIG.PLANNER_DAYS !== undefined) ? CONFIG.PLANNER_DAYS : 7;

            for (var pi = 0; pi < plannerDays; pi++) {
                var tDate = new Date();
                tDate.setDate(now.getDate() + pi);
                var tStr = getLocalDateStr(tDate);

                var dayEvents = sortEvents(events.filter(function (e) {
                    var eventDate = e.start.date ||
                        (e.start.dateTime ? getLocalDateStr(new Date(e.start.dateTime)) : null);
                    return eventDate === tStr;
                }));

                var pHeader = document.createElement('div');
                pHeader.className = 'planner-date-header';
                pHeader.textContent = pi === 0
                    ? 'TODAY'
                    : tDate.toLocaleDateString('default', { weekday: 'short', day: 'numeric' }).toUpperCase();
                plannerFragment.appendChild(pHeader);

                if (dayEvents.length === 0) {
                    var noEvt = document.createElement('div');
                    noEvt.className = 'event-item no-events';
                    noEvt.style.borderLeftColor = 'var(--border)';
                    var noTitle = document.createElement('div');
                    noTitle.className = 'title';
                    noTitle.textContent = 'No Events';
                    noEvt.appendChild(noTitle);
                    plannerFragment.appendChild(noEvt);
                } else {
                    for (var ei = 0; ei < dayEvents.length; ei++) {
                        var ev = dayEvents[ei];
                        var timeStr = ev.start.date
                            ? 'ALL DAY'
                            : new Date(ev.start.dateTime)
                                .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                                .replace(' ', '')
                                .toLowerCase();

                        var evItem = document.createElement('div');
                        evItem.className = 'event-item';
                        evItem.style.borderLeftColor = ev.color;

                        var timeDiv = document.createElement('div');
                        timeDiv.className = 'time';
                        timeDiv.textContent = timeStr;

                        var titleDiv = document.createElement('div');
                        titleDiv.className = 'title';
                        titleDiv.textContent = ev.summary;

                        evItem.appendChild(timeDiv);
                        evItem.appendChild(titleDiv);
                        plannerFragment.appendChild(evItem);
                    }
                }
            }
            eventList.innerHTML = '';
            eventList.appendChild(plannerFragment);

            // ── Legend ────────────────────────────────────────────
            var legendFragment = document.createDocumentFragment();
            for (var li = 0; li < legendData.length; li++) {
                var lItem = legendData[li];
                var keyDiv = document.createElement('div');
                keyDiv.className = 'key-item';

                var dotSpan = document.createElement('span');
                dotSpan.className = 'dot';
                dotSpan.style.background = lItem.color;

                keyDiv.appendChild(dotSpan);
                keyDiv.appendChild(document.createTextNode(' ' + lItem.name.toUpperCase()));
                legendFragment.appendChild(keyDiv);
            }
            dockedLegend.innerHTML = '';
            dockedLegend.appendChild(legendFragment);

            // ── Calendar Grid ─────────────────────────────────────
            var calFragment = document.createDocumentFragment();

            // Day-of-week headers
            var dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
            for (var di = 0; di < dayNames.length; di++) {
                var dh = document.createElement('div');
                dh.className = 'day-header';
                dh.textContent = dayNames[di];
                calFragment.appendChild(dh);
            }

            var firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            var startingDay = firstDayOfMonth.getDay();
            var startDate = new Date(firstDayOfMonth);
            startDate.setDate(firstDayOfMonth.getDate() - startingDay);

            var totalCells = 42; // 6 weeks
            monthHeader.textContent = now.toLocaleDateString('default', {
                month: 'long',
                year: 'numeric'
            }).toUpperCase();

            for (var ci = 0; ci < totalCells; ci++) {
                var currentDay = new Date(startDate);
                currentDay.setDate(startDate.getDate() + ci);
                var currentDayStr = getLocalDateStr(currentDay);

                var isToday = currentDayStr === todayStr;
                var isOtherMonth = currentDay.getMonth() !== now.getMonth();

                var cellEvents = sortEvents(events.filter(function (e) {
                    var eventDate = e.start.date ||
                        (e.start.dateTime ? getLocalDateStr(new Date(e.start.dateTime)) : null);
                    return eventDate === currentDayStr;
                }));

                // Limit events per cell for performance
                var maxEventsPerCell = 2;
                var timedEvents = [];
                var allDayEvents = [];
                for (var ce = 0; ce < cellEvents.length; ce++) {
                    if (cellEvents[ce].start.dateTime) {
                        timedEvents.push(cellEvents[ce]);
                    } else {
                        allDayEvents.push(cellEvents[ce]);
                    }
                }
                timedEvents = timedEvents.slice(0, maxEventsPerCell);

                var filteredAllDay = [];
                if (allDayEvents.length > 0) {
                    var highestPriority = 99;
                    for (var ap = 0; ap < allDayEvents.length; ap++) {
                        var p = allDayEvents[ap].priority || 99;
                        if (p < highestPriority) highestPriority = p;
                    }
                    for (var af = 0; af < allDayEvents.length; af++) {
                        if ((allDayEvents[af].priority || 99) === highestPriority) {
                            filteredAllDay.push(allDayEvents[af]);
                            if (filteredAllDay.length >= 1) break;
                        }
                    }
                }

                // Build cell HTML
                var timedHtml = '';
                for (var ti = 0; ti < timedEvents.length; ti++) {
                    var te = timedEvents[ti];
                    var cellTime = new Date(te.start.dateTime)
                        .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                        .replace(' ', '')
                        .toLowerCase();
                    timedHtml += '<div class="cell-event" style="border-left-color:' + te.color +
                        '"><span class="cell-time">' + cellTime + '</span> ' + te.summary + '</div>';
                }

                var allDayHtml = '';
                if (filteredAllDay.length > 0) {
                    allDayHtml = '<div class="all-day-anchor">';
                    for (var ai = 0; ai < filteredAllDay.length; ai++) {
                        allDayHtml += '<div class="cell-event all-day-row" style="border-left-color:' +
                            filteredAllDay[ai].color + '">' + filteredAllDay[ai].summary + '</div>';
                    }
                    allDayHtml += '</div>';
                }

                var dayCell = document.createElement('div');
                dayCell.className = 'day-cell' +
                    (isOtherMonth ? ' other-month' : '') +
                    (isToday ? ' today' : '');
                dayCell.innerHTML =
                    '<div class="day-number">' + currentDay.getDate() + '</div>' +
                    '<div class="cell-events">' + timedHtml + allDayHtml + '</div>';
                calFragment.appendChild(dayCell);
            }

            calendarGrid.innerHTML = '';
            calendarGrid.appendChild(calFragment);

            // Create Lucide icons for the main weather icon
            lucide.createIcons({ container: weatherMainIcon });
        });
    }).catch(function (error) {
        console.error('Failed to update dashboard:', error);
        connectionWarning.classList.remove('hidden');

        // Show spinners in dynamic areas
        eventList.innerHTML = '<div class="spinner"></div>';
        weatherMainIcon.innerHTML = '<div class="spinner"></div>';
        forecastGrid.innerHTML = '<div class="spinner"></div>';
        calendarGrid.innerHTML = '<div class="spinner"></div>';
        dockedLegend.innerHTML = '<div class="spinner"></div>';
        monthHeader.textContent = 'CONNECTION ERROR';
        weatherTemp.textContent = '--\u00B0';
        weatherCondition.textContent = 'ERROR';
    });
}

/* ================================================================== *
 *  6. Shopping List Polling
 * ================================================================== */

// Track the last rendered payload to avoid unnecessary re-renders
var _lastShoppingPayload = null;

/**
 * Fetch, categorise, and render the shopping list.
 * Only re-renders if the data has actually changed (JSON comparison).
 */
function updateShoppingList() {
    fetchShoppingItems().then(function (items) {
        if (!items) items = [];
        var grouped = groupShoppingItems(items);
        var payload = JSON.stringify(grouped);
        if (payload !== _lastShoppingPayload) {
            _lastShoppingPayload = payload;
            renderShoppingList(grouped);
        }
    }).catch(function (err) {
        console.error('Shopping list update error:', err);
    });
}

/* ================================================================== *
 *  7. Cursor Hiding (kiosk mode)
 * ================================================================== */

var _hideCursorTimeout;
document.addEventListener('mousemove', function () {
    document.body.style.cursor = 'none';
    clearTimeout(_hideCursorTimeout);
    _hideCursorTimeout = setTimeout(function () {
        document.body.style.cursor = 'none';
    }, 100);
});
document.addEventListener('mouseleave', function () {
    document.body.style.cursor = 'none';
});

/* ================================================================== *
 *  8. Initialisation
 * ================================================================== */

// Initial calls
updateClock();
updateDashboard();
updateShoppingList();

// Recurring intervals
setInterval(updateClock, 1000);
setInterval(updateDashboard, 60000);
setInterval(updateShoppingList, (CONFIG.CACHE_DURATION.shopping || 30) * 1000);
