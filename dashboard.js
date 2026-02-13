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

/* ── Auth note ────────────────────────────────────────────────────────
 * Even though this page is served from HA's own www folder (same origin,
 * http://ha:8123/local/…), the HA REST API (/api/) does NOT honour browser
 * session cookies.  Every REST request and the WebSocket auth handshake
 * must carry an explicit "Authorization: Bearer <token>" header.
 * The long-lived access token in CONFIG.HA_TOKEN is therefore always
 * required regardless of origin.
 * See: https://developers.home-assistant.io/docs/api/rest/
 * ──────────────────────────────────────────────────────────────────── */

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
    shopping: { data: null, timestamp: null },
    dinner:   { data: null, timestamp: null }
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
 *
 * Update strategy: two complementary paths keep weather current:
 *   1. Reactive — WebSocket state_changed on CONFIG.WEATHER_ENTITY busts the
 *      cache and calls updateDashboard() immediately (via _debouncedDashboardUpdate).
 *   2. Polling  — setInterval(updateDashboard, 60000) fires every 60 s as a
 *      safety net in case the WebSocket is temporarily disconnected.
 * The 60-second cache TTL matches the polling interval so a polling cycle
 * always fetches fresh data while the WebSocket path forces an immediate fetch
 * by nulling the timestamp before calling updateDashboard().
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
            cache.forecast.data = forecasts;
            cache.forecast.timestamp = Date.now();
        }
        return forecasts;
    });
}

/**
 * Fetch indoor climate data from the thermostat entity.
 * Returns {temperature, humidity} or null on failure.
 */
function fetchIndoorClimate() {
    return haFetch('states/' + CONFIG.THERMOSTAT_ENTITY).then(function (data) {
        if (data && data.attributes) {
            return {
                temperature: data.attributes.current_temperature,
                humidity: data.attributes.current_humidity
            };
        }
        return null;
    });
}

/**
 * Calculate the start and end dates for the 6-week calendar grid.
 *
 * The grid always shows 42 cells (6 rows x 7 cols).  Row 0 starts on the
 * Sunday on or before the 1st of the current month, and the grid ends
 * exactly 42 days later.  These dates are used both to render the grid cells
 * and to determine the fetch window for calendar events so every visible
 * cell can show events — no more, no less.
 *
 * @param {Date} now  Reference date (usually new Date()).
 * @returns {{ gridStart: Date, gridEnd: Date }}
 *   gridStart — first day shown in the grid (inclusive)
 *   gridEnd   — day AFTER the last cell (exclusive, for ISO range queries)
 */
function calcGridDateRange(now) {
    var firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    // getDay() returns 0=Sun … 6=Sat.  Subtract it to reach the preceding Sunday.
    var gridStart = new Date(firstOfMonth);
    gridStart.setDate(firstOfMonth.getDate() - firstOfMonth.getDay());

    // Exclusive end: day after the 42nd cell
    var gridEnd = new Date(gridStart);
    gridEnd.setDate(gridStart.getDate() + 42);

    return { gridStart: gridStart, gridEnd: gridEnd };
}

/**
 * Fetch calendar events for all configured calendars, covering the exact
 * 6-week grid window so every visible cell can render its events.
 *
 * Events are always fetched fresh (no cache) because they change frequently
 * and there is no server-side cache invalidation mechanism for calendars.
 *
 * Calendar entity state changes in HA (e.g. a new event is added) trigger
 * a state_changed WebSocket event on the calendar entity.  Those entities
 * are listed in _dashboardEntities, so _debouncedDashboardUpdate() fires,
 * which busts weather/theme/forecast caches and calls updateDashboard().
 * updateDashboard() always calls fetchCalendarEvents() fresh, so calendar
 * data is always up to date after a WebSocket-triggered refresh.
 *
 * @param {boolean} isDark     Current theme — selects color_dark or color_light.
 * @param {Date}    gridStart  First day of the 6-week grid (from calcGridDateRange).
 * @param {Date}    gridEnd    Exclusive end date of the 6-week grid.
 * @returns {Promise<Array>}   Flat array of event objects with color & priority attached.
 */
function fetchCalendarEvents(isDark, gridStart, gridEnd) {
    var startISO = gridStart.toISOString();
    var endISO   = gridEnd.toISOString();

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
        if (resp) {
            cache.shopping.data = normalised;
            cache.shopping.timestamp = Date.now();
        }
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
var weatherHumidity   = document.getElementById('weather-humidity');
var weatherPrecip     = document.getElementById('weather-precip');
var forecastGrid      = document.getElementById('forecast-grid');
var groceryList       = document.getElementById('grocery-list');
var calendarGrid      = document.getElementById('grid');
var monthHeader       = document.getElementById('month-header');
var indoorClimate     = document.getElementById('indoor-climate');
var dinnerContent     = document.getElementById('dinner-content');

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

/** Map HA weather condition keys to human-readable labels. */
var _conditionLabels = {
    'sunny':          'SUNNY',
    'clearnight':     'CLEAR NIGHT',
    'clear-night':    'CLEAR NIGHT',
    'cloudy':         'CLOUDY',
    'fog':            'FOG',
    'hail':           'HAIL',
    'lightning':      'LIGHTNING',
    'lightningrain':  'LTNG & RAIN',
    'lightning-rainy':'LTNG & RAIN',
    'partlycloudy':   'PARTLY CLOUDY',
    'pouring':        'POURING',
    'rainy':          'RAINY',
    'snowy':          'SNOWY',
    'snowyrainy':     'SNOW & RAIN',
    'snowy-rainy':    'SNOW & RAIN',
    'windy':          'WINDY',
    'windyvariant':   'WINDY',
    'windy-variant':  'WINDY',
    'exceptional':    'EXCEPTIONAL'
};

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
        empty.className = 'grocery-empty';
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
 *
 * Weather update strategy (two complementary paths):
 *   Reactive path — WebSocket state_changed on WEATHER_ENTITY busts the cache
 *     and calls this function immediately.
 *   Polling path  — setInterval(updateDashboard, 60000) fires every 60 s as a
 *     safety net when the WebSocket is disconnected or idle.
 * Both paths are needed: the WebSocket gives sub-second latency on changes,
 * the poll guarantees recovery if the socket was down during an update.
 *
 * Calendar update strategy:
 *   Calendar entities are in _dashboardEntities.  Any state_changed event on
 *   them (new event, edit, delete) triggers _debouncedDashboardUpdate(), which
 *   calls this function.  fetchCalendarEvents() has no cache — it always fetches
 *   fresh — so the calendar data is immediately up to date after each WebSocket
 *   trigger.  The 60-second poll provides the same fallback as for weather.
 */
function updateDashboard() {
    // Fetch theme first — the result determines calendar event colours.
    fetchTheme().then(function (isDark) {
        // Apply theme class
        document.body.className = isDark ? '' : 'light-theme';

        // Calculate the exact 6-week grid window once, share it with
        // fetchCalendarEvents so the fetch range matches the rendered cells
        // precisely.  This replaces the old fixed "now-3 / now+14" window which
        // left the first and last rows of the grid without event data.
        var now = new Date();
        var gridRange = calcGridDateRange(now);

        // Fetch weather, forecast, and calendar events in parallel
        return Promise.all([
            fetchWeather(),
            fetchForecast(),
            fetchCalendarEvents(isDark, gridRange.gridStart, gridRange.gridEnd),
            fetchIndoorClimate()
        ]).then(function (results) {
            var weather = results[0];
            var forecast = results[1];
            var events = results[2];
            var climate = results[3];

            // Hide connection warning on success
            connectionWarning.classList.add('hidden');

            // ── Weather ───────────────────────────────────────────
            if (weather && weather.state !== 'unavailable' && weather.state !== 'unknown') {
                weatherMainIcon.innerHTML = getWeatherIcon(weather.state, 'large-icon');
                var temp = weather.attributes && weather.attributes.temperature;
                weatherTemp.textContent = (temp != null ? Math.round(temp) : '--') + '\u00B0';
                weatherCondition.textContent = _conditionLabels[weather.state.toLowerCase()] || _conditionLabels[weather.state.toLowerCase().replace(/-/g, '')] || weather.state.toUpperCase();
            } else {
                if (!weather) {
                    console.warn('Weather fetch returned null — verify WEATHER_ENTITY ("' +
                        CONFIG.WEATHER_ENTITY + '") exists in HA (Developer Tools → States)');
                } else {
                    console.warn('Weather entity state is "' + weather.state +
                        '" — check your HA weather integration');
                }
                weatherMainIcon.innerHTML = getWeatherIcon('cloudy', 'large-icon');
                weatherTemp.textContent = '--\u00B0';
                weatherCondition.textContent = 'UNAVAILABLE';
            }

            // ── Outdoor Humidity ───────────────────────────────────
            if (weather && weather.attributes && weather.attributes.humidity != null) {
                weatherHumidity.innerHTML =
                    '<i data-lucide="droplets"></i> ' + Math.round(weather.attributes.humidity) + '%';
                lucide.createIcons({ container: weatherHumidity });
            } else {
                weatherHumidity.textContent = '';
            }

            // ── Precipitation Probability ─────────────────────────
            if (weather && weather.attributes && weather.attributes.precipitation_probability != null) {
                weatherPrecip.innerHTML =
                    '<i data-lucide="cloud-rain"></i> ' + Math.round(weather.attributes.precipitation_probability) + '%';
                lucide.createIcons({ container: weatherPrecip });
            } else {
                weatherPrecip.textContent = '';
            }

            // ── Indoor Climate ────────────────────────────────────
            if (climate) {
                var climateHtml = '<span class="climate-label">ecobee:</span>';
                if (climate.temperature != null) {
                    climateHtml += '<span class="climate-pair"><i data-lucide="thermometer"></i> ' +
                        climate.temperature.toFixed(1) + '\u00B0</span>';
                }
                if (climate.humidity != null) {
                    climateHtml += '<span class="climate-pair"><i data-lucide="droplets"></i> ' +
                        Math.round(climate.humidity) + '%</span>';
                }
                indoorClimate.innerHTML = climateHtml;
                lucide.createIcons({ container: indoorClimate });
            } else {
                indoorClimate.textContent = '';
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
                        dayLabel = 'TOMORROW';
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

            // ── Calendar Grid ─────────────────────────────────────
            var todayStr = getLocalDateStr(now);
            // The grid start date was already computed above in gridRange.gridStart.
            // We reuse it here so the cells exactly match the event fetch window.
            var calFragment = document.createDocumentFragment();

            // Day-of-week headers
            var dayNames = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
            for (var di = 0; di < dayNames.length; di++) {
                var dh = document.createElement('div');
                dh.className = 'day-header';
                dh.textContent = dayNames[di];
                calFragment.appendChild(dh);
            }

            var startDate = gridRange.gridStart;
            var totalCells = 42; // 6 weeks x 7 days
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
                    if (e.start.date) {
                        // All-day event: show on every day from start (inclusive) to end (exclusive)
                        var endDate = (e.end && e.end.date) ? e.end.date : null;
                        if (endDate) {
                            return currentDayStr >= e.start.date && currentDayStr < endDate;
                        }
                        return currentDayStr === e.start.date;
                    }
                    // Timed event: match by start date
                    if (e.start.dateTime) {
                        return getLocalDateStr(new Date(e.start.dateTime)) === currentDayStr;
                    }
                    return false;
                }));

                // Separate events into: multi-day (top), timed, single all-day (bottom)
                var maxEventsPerCell = 2;
                var timedEvents = [];
                var multiDayEvents = [];
                var singleAllDayEvents = [];
                for (var ce = 0; ce < cellEvents.length; ce++) {
                    var evt = cellEvents[ce];
                    if (evt.start.dateTime) {
                        timedEvents.push(evt);
                    } else if (evt.start.date) {
                        // Multi-day: has an end date different from start date
                        var evtEnd = (evt.end && evt.end.date) ? evt.end.date : null;
                        var dayAfterStart = new Date(evt.start.date + 'T00:00:00');
                        dayAfterStart.setDate(dayAfterStart.getDate() + 1);
                        var dayAfterStr = getLocalDateStr(dayAfterStart);
                        if (evtEnd && evtEnd > dayAfterStr) {
                            multiDayEvents.push(evt);
                        } else {
                            singleAllDayEvents.push(evt);
                        }
                    }
                }
                timedEvents = timedEvents.slice(0, maxEventsPerCell);

                // Multi-day events bypass priority filtering — show all
                // Single all-day events use priority filtering
                var filteredSingleAllDay = [];
                if (singleAllDayEvents.length > 0) {
                    var highestPriority = 99;
                    for (var ap = 0; ap < singleAllDayEvents.length; ap++) {
                        var p = singleAllDayEvents[ap].priority || 99;
                        if (p < highestPriority) highestPriority = p;
                    }
                    for (var af = 0; af < singleAllDayEvents.length; af++) {
                        if ((singleAllDayEvents[af].priority || 99) === highestPriority) {
                            filteredSingleAllDay.push(singleAllDayEvents[af]);
                            if (filteredSingleAllDay.length >= 1) break;
                        }
                    }
                }

                // Build cell HTML — multi-day docked at top
                var multiDayHtml = '';
                if (multiDayEvents.length > 0) {
                    multiDayHtml = '<div class="all-day-events">';
                    for (var mi = 0; mi < multiDayEvents.length; mi++) {
                        var mdEvent = multiDayEvents[mi];
                        var isContinuation = mdEvent.start.date && mdEvent.start.date < currentDayStr;
                        var contClass = isContinuation ? ' multi-day-continue' : '';
                        var prefix = isContinuation ? '\u2026 ' : '';
                        multiDayHtml += '<div class="cell-event all-day-row' + contClass +
                            '" style="border-left-color:' + mdEvent.color + '">' +
                            prefix + mdEvent.summary + '</div>';
                    }
                    multiDayHtml += '</div>';
                }

                // Timed events
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

                // Single all-day events docked at bottom
                var singleAllDayHtml = '';
                for (var ai = 0; ai < filteredSingleAllDay.length; ai++) {
                    var adEvent = filteredSingleAllDay[ai];
                    singleAllDayHtml += '<div class="cell-event all-day-row' +
                        '" style="border-left-color:' + adEvent.color + '">' +
                        adEvent.summary + '</div>';
                }

                var dayCell = document.createElement('div');
                dayCell.className = 'day-cell' +
                    (isOtherMonth ? ' other-month' : '') +
                    (isToday ? ' today' : '');
                dayCell.innerHTML =
                    '<div class="day-number">' + currentDay.getDate() + '</div>' +
                    '<div class="cell-top-zone">' + multiDayHtml + '</div>' +
                    '<div class="cell-events">' + timedHtml + '</div>' +
                    '<div class="cell-events-bottom">' + singleAllDayHtml + '</div>';
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
        weatherMainIcon.innerHTML = '<div class="spinner"></div>';
        forecastGrid.innerHTML = '<div class="spinner"></div>';
        calendarGrid.innerHTML = '<div class="spinner"></div>';
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
 *  6b. Dinner Suggestions (LLM + HA persistence)
 * ================================================================== */

/**
 * Call the LLM API to generate dinner suggestions.
 * Returns parsed JSON array of meal objects, or null on failure.
 */
function callLLM(prompt) {
    var url = CONFIG.LLM_URL + '/api/generate';
    console.log('[Dinner] Calling LLM at:' + url);
    var controller = new AbortController();
    var timeoutId = setTimeout(function () { controller.abort(); }, 60000);

    return fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
            model: CONFIG.LLM_MODEL,
            prompt: prompt,
            stream: false,
            format: 'json'
        })
    })
    .then(function (response) {
        clearTimeout(timeoutId);
        console.log('[Dinner] LLM HTTP status:' + response.status);
        if (!response.ok) {
            return response.text().then(function (t) {
                console.warn('[Dinner] LLM error body:' + t);
                return null;
            });
        }
        return response.json();
    })
    .then(function (data) {
        if (!data || !data.response) {
            console.warn('[Dinner] LLM returned no response field:', data);
            return null;
        }
        console.log('[Dinner] LLM raw response:' + data.response.substring(0, 500));
        try {
            var parsed = JSON.parse(data.response);
            // Accept either {meals: [...]} or direct [...]
            if (Array.isArray(parsed)) return parsed;
            if (parsed.meals && Array.isArray(parsed.meals)) return parsed.meals;
            console.warn('[Dinner] LLM JSON has no meals array:', parsed);
            return null;
        } catch (e) {
            console.error('[Dinner] LLM JSON parse error:', e, data.response);
            return null;
        }
    })
    .catch(function (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            console.error('[Dinner] LLM timeout (60s)');
        } else {
            console.error('[Dinner] LLM fetch error:', err.message || err);
        }
        return null;
    });
}

/**
 * Save dinner suggestions to HA as a virtual sensor's attributes.
 * No HA helper setup needed — POST /api/states creates it on the fly.
 */
function saveDinnerToHA(meals) {
    return haFetch('states/' + CONFIG.DINNER_ENTITY, 'POST', {
        state: 'ok',
        attributes: {
            meals: meals,
            generated_at: new Date().toISOString(),
            friendly_name: 'Dinner Suggestions'
        }
    });
}

/**
 * Read dinner suggestions from HA sensor entity.
 * Returns {meals, generated_at} or null if not found/empty.
 */
function readDinnerFromHA() {
    if (isCacheValid('dinner')) {
        return Promise.resolve(cache.dinner.data);
    }
    return haFetch('states/' + CONFIG.DINNER_ENTITY).then(function (data) {
        if (data && data.attributes && data.attributes.meals) {
            var result = {
                meals: data.attributes.meals,
                generated_at: data.attributes.generated_at || null
            };
            cache.dinner.data = result;
            cache.dinner.timestamp = Date.now();
            return result;
        }
        return null;
    }).catch(function () {
        return null;
    });
}

/**
 * Check if stored dinner data is stale (older than DINNER_REFRESH_HOURS).
 */
function isDinnerStale(generatedAt) {
    if (!generatedAt) return true;
    var genTime = new Date(generatedAt).getTime();
    var ageHours = (Date.now() - genTime) / (1000 * 60 * 60);
    return ageHours >= CONFIG.DINNER_REFRESH_HOURS;
}

/**
 * Build a recipe search URL from a meal name.
 */
function buildRecipeUrl(mealName) {
    return 'https://www.google.com/search?q=' + encodeURIComponent(mealName + ' recipe');
}

/**
 * Push a recipe link notification to a specific device via HA notify service.
 */
function pushRecipeToPhone(device, mealName) {
    var searchUrl = buildRecipeUrl(mealName);
    var servicePath = device.service.replace('.', '/');
    return haFetch('services/' + servicePath, 'POST', {
        message: "Tonight's dinner idea: " + mealName,
        data: {
            url: searchUrl,
            actions: [{ action: "URI", title: "Open Recipe", uri: searchUrl }]
        }
    });
}

/**
 * Render meal cards into #dinner-content.
 */
function renderDinnerPanel(meals) {
    var fragment = document.createDocumentFragment();

    if (!meals || meals.length === 0) {
        var empty = document.createElement('div');
        empty.className = 'dinner-status';
        empty.textContent = 'No suggestions yet';
        fragment.appendChild(empty);
        dinnerContent.innerHTML = '';
        dinnerContent.appendChild(fragment);
        return;
    }

    for (var i = 0; i < meals.length; i++) {
        var meal = meals[i];
        var card = document.createElement('div');
        card.className = 'dinner-meal';

        var diffClass = (meal.difficulty || 'medium').toLowerCase();
        if (['easy', 'medium', 'hard'].indexOf(diffClass) === -1) diffClass = 'medium';

        var html =
            '<div class="dinner-meal-name">' + escapeHtml(meal.name) + '</div>' +
            '<div class="dinner-meal-meta">' +
                '<span class="dinner-time"><i data-lucide="clock"></i> ' + (meal.time_minutes || '?') + ' min</span>' +
                '<span class="dinner-difficulty ' + diffClass + '">' + diffClass + '</span>' +
            '</div>';

        card.innerHTML = html;
        fragment.appendChild(card);
    }

    dinnerContent.innerHTML = '';
    dinnerContent.appendChild(fragment);
    lucide.createIcons({ container: dinnerContent });
}

/**
 * Simple HTML escaping for user-facing text from LLM.
 */
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;');
}

/**
 * Main dinner update: read from HA, call LLM if stale, render.
 */
var _dinnerLoading = false;

function updateDinner() {
    console.log('[Dinner] updateDinner called');
    readDinnerFromHA().then(function (stored) {
        console.log('[Dinner] HA stored data:', stored ? 'found (' + (stored.meals ? stored.meals.length : 0) + ' meals, generated: ' + stored.generated_at + ')' : 'null');
        if (stored && stored.meals && !isDinnerStale(stored.generated_at)) {
            console.log('[Dinner] Using cached HA data (not stale)');
            renderDinnerPanel(stored.meals);
            return;
        }
        console.log('[Dinner] Data is stale or missing, will call LLM');

        // Data is stale or missing — generate new suggestions
        if (_dinnerLoading) {
            // Already generating, just render what we have
            if (stored && stored.meals) {
                renderDinnerPanel(stored.meals);
            } else {
                dinnerContent.innerHTML = '<div class="dinner-status"><div class="spinner"></div> Generating ideas…</div>';
            }
            return;
        }

        _dinnerLoading = true;
        // Show loading state
        if (stored && stored.meals) {
            renderDinnerPanel(stored.meals);
        } else {
            dinnerContent.innerHTML = '<div class="dinner-status"><div class="spinner"></div> Generating ideas…</div>';
        }

        var prompt = 'Suggest 3 different weeknight dinner meals.\n\n' +
            'Respond with JSON in EXACTLY this format:\n\n' +
            '{"meals": [{"name": "Chicken Stir Fry", "difficulty": "easy", "time_minutes": 25}, ' +
            '{"name": "Beef Tacos", "difficulty": "medium", "time_minutes": 35}, ' +
            '{"name": "Homemade Lasagna", "difficulty": "hard", "time_minutes": 60}]}\n\n' +
            'Rules:\n' +
            '- Return exactly 3 meals in the "meals" array\n' +
            '- Each meal has exactly 3 fields: "name" (string), "difficulty" ("easy" or "medium" or "hard"), "time_minutes" (number)\n' +
            '- Suggest different meals than the example above\n' +
            '- No other fields or text';

        callLLM(prompt).then(function (meals) {
            _dinnerLoading = false;
            if (meals && meals.length > 0) {
                // Validate structure
                var valid = [];
                for (var i = 0; i < meals.length; i++) {
                    var m = meals[i];
                    if (m.name) {
                        valid.push({
                            name: String(m.name),
                            difficulty: String(m.difficulty || 'medium'),
                            time_minutes: parseInt(m.time_minutes, 10) || 30
                        });
                    }
                }
                if (valid.length > 0) {
                    saveDinnerToHA(valid);
                    cache.dinner.data = { meals: valid, generated_at: new Date().toISOString() };
                    cache.dinner.timestamp = Date.now();
                    renderDinnerPanel(valid);
                    return;
                }
            }
            // LLM failed or returned bad data — show stored or error
            if (stored && stored.meals) {
                renderDinnerPanel(stored.meals);
            } else {
                dinnerContent.innerHTML = '<div class="dinner-status">Could not get suggestions</div>';
            }
        });
    }).catch(function (err) {
        console.error('Dinner update error:', err);
        _dinnerLoading = false;
    });
}

/* ================================================================== *
 *  7. HA WebSocket — Real-time Updates
 * ================================================================== */

/**
 * Maintains a persistent WebSocket connection to Home Assistant.
 * Subscribes to state_changed events and triggers the appropriate
 * refresh when a watched entity changes — no browser reload needed.
 *
 * Reconnects automatically on disconnect with exponential backoff.
 *
 * Entity watch lists:
 *   _shoppingEntities — triggers an immediate shopping list cache bust + re-render.
 *   _dashboardEntities — triggers a full dashboard refresh (weather, forecast,
 *     calendar, theme).  Includes all CONFIG.CALENDARS entities so any calendar
 *     change in HA (event added/edited/deleted) triggers a fresh calendar fetch.
 */
var _ws = null;
var _wsMsgId = 0;
var _wsReconnectDelay = 1000; // ms, doubles on each failure up to 30 s
var _wsMaxDelay = 30000;

// Entities that should trigger an immediate shopping list refresh
var _shoppingEntities = {};
_shoppingEntities[CONFIG.SHOPPING_LIST_ENTITY] = true;

// Entities that should trigger a full dashboard refresh.
// Calendar entities are included so that when HA fires state_changed
// for a calendar (e.g. a new event is synced from Google Calendar),
// fetchCalendarEvents() is called fresh within the next updateDashboard().
var _dashboardEntities = {};
_dashboardEntities[CONFIG.WEATHER_ENTITY] = true;
_dashboardEntities[CONFIG.THEME_ENTITY] = true;
_dashboardEntities[CONFIG.SCREEN_BLANK_ENTITY] = true;
_dashboardEntities[CONFIG.THERMOSTAT_ENTITY] = true;
if (CONFIG.DINNER_ENTITY) {
    _dashboardEntities[CONFIG.DINNER_ENTITY] = true;
}
for (var _ci = 0; _ci < CONFIG.CALENDARS.length; _ci++) {
    _dashboardEntities[CONFIG.CALENDARS[_ci].entity] = true;
}

// Debounce helpers — avoid hammering HA when multiple entities change at once
var _dashboardDebounce = null;
var _shoppingDebounce = null;

function _debouncedDashboardUpdate() {
    if (_dashboardDebounce) clearTimeout(_dashboardDebounce);
    _dashboardDebounce = setTimeout(function () {
        // Bust relevant caches so we fetch fresh data.
        // Calendar events have no cache (always fetched fresh), so no bust needed there.
        cache.weather.timestamp = null;
        cache.theme.timestamp = null;
        cache.forecast.timestamp = null;
        updateDashboard();
    }, 500);
}

function _debouncedShoppingUpdate() {
    if (_shoppingDebounce) clearTimeout(_shoppingDebounce);
    _shoppingDebounce = setTimeout(function () {
        cache.shopping.timestamp = null;
        updateShoppingList();
    }, 500);
}

function _wsConnect() {
    var base = CONFIG.HA_URL || (window.location.protocol + '//' + window.location.host);
    var wsUrl = base.replace(/^http/, 'ws') + '/api/websocket';

    try {
        _ws = new WebSocket(wsUrl);
    } catch (e) {
        console.error('WebSocket creation failed:', e);
        _wsScheduleReconnect();
        return;
    }

    _ws.onmessage = function (event) {
        var msg;
        try { msg = JSON.parse(event.data); } catch (e) { return; }

        switch (msg.type) {
            case 'auth_required':
                // HA WebSocket also requires explicit token auth — same rule as REST.
                _ws.send(JSON.stringify({
                    type: 'auth',
                    access_token: CONFIG.HA_TOKEN
                }));
                break;

            case 'auth_ok':
                console.log('WebSocket authenticated');
                _wsReconnectDelay = 1000; // reset backoff on success
                // Subscribe to all state_changed events
                _wsMsgId++;
                _ws.send(JSON.stringify({
                    id: _wsMsgId,
                    type: 'subscribe_events',
                    event_type: 'state_changed'
                }));
                break;

            case 'auth_invalid':
                console.error('WebSocket auth failed:', msg.message);
                break;

            case 'event':
                if (msg.event && msg.event.event_type === 'state_changed') {
                    var entityId = msg.event.data.entity_id;
                    if (_shoppingEntities[entityId]) {
                        _debouncedShoppingUpdate();
                    }
                    if (_dashboardEntities[entityId]) {
                        _debouncedDashboardUpdate();
                    }
                }
                break;
        }
    };

    _ws.onclose = function () {
        console.warn('WebSocket closed, reconnecting in ' + _wsReconnectDelay + 'ms');
        _wsScheduleReconnect();
    };

    _ws.onerror = function () {
        // onclose will fire after this, which handles reconnection
    };
}

function _wsScheduleReconnect() {
    setTimeout(_wsConnect, _wsReconnectDelay);
    _wsReconnectDelay = Math.min(_wsReconnectDelay * 2, _wsMaxDelay);
}

// Start the WebSocket connection
_wsConnect();

/* ================================================================== *
 *  8. Cursor Hiding (kiosk mode)
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
 *  9. Initialisation
 * ================================================================== */

// Initial calls
updateClock();
updateDashboard();
updateShoppingList();
updateDinner();

// Recurring intervals
setInterval(updateClock, 1000);
setInterval(updateDashboard, 60000);
setInterval(updateShoppingList, (CONFIG.CACHE_DURATION.shopping || 30) * 1000);
setInterval(updateDinner, 60 * 60 * 1000); // check hourly, only calls LLM if stale
