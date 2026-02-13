// Dashboard Configuration
// Edit this file to customize your HAPi dashboard

const CONFIG = {

    // ==================== HOME ASSISTANT CONNECTION ====================
    HA_URL: "",  // empty = use relative URLs (same origin as the page)
    HA_TOKEN: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiI0MGZiZTM4NWQ2MGI0YzIwODExZWVhYjExZjZhOWVhNCIsImlhdCI6MTc3MDQ5OTMxMywiZXhwIjoyMDg1ODU5MzEzfQ.o5fivSvhvrgDrrZncOBpq0xx_Le3hpfGDj-A2s0b4jk",

    // ==================== WEATHER ====================
    WEATHER_ENTITY: "weather.forecast_home",

    // ==================== INDOOR CLIMATE ====================
    THERMOSTAT_ENTITY: "climate.my_ecobee",

    // ==================== CALENDARS ====================
    CALENDARS: [
        {
            entity: "calendar.devin_g_lanz1_gmail_com",
            name: "Devin",
            color_dark: "#51cf66",
            color_light: "#388E3C",
            priority: 1
        },
        {
            entity: "calendar.mearley046_gmail_com",
            name: "Megan",
            color_dark: "#ff6b6b",
            color_light: "#D32F2F",
            priority: 1
        },
        {
            entity: "calendar.holidays_in_united_states",
            name: "Holidays",
            color_dark: "#FFD700",
            color_light: "#DAA520",
            priority: 3
        },
        {
            entity: "calendar.birthdays",
            name: "Birthdays",
            color_dark: "#4a9eff",
            color_light: "#1976D2",
            priority: 2
        }
    ],

    // ==================== THEME SETTINGS ====================
    THEME_ENTITY: "input_boolean.calendar_dashboard_dark_mode",
    SCREEN_BLANK_ENTITY: "input_boolean.calendar_dashboard_blank_screen",

    // ==================== SHOPPING LIST ====================
    SHOPPING_LIST_ENTITY: "todo.shopping_list",

    GROCERY_CATEGORIES: [
        { keywords: ["frozen"],                                                    category: "Frozen" },
        { keywords: ["chip", "cracker", "pretzel", "snack", "popcorn"],           category: "Snacks" },
        { keywords: ["apple", "banana", "berry", "grape", "lemon", "lime",
                     "orange", "peach", "pear", "strawberr", "tomato",
                     "lettuce", "spinach", "carrot", "celery", "onion",
                     "potato", "broccoli", "pepper", "cucumber", "zucchini",
                     "avocado", "mushroom", "garlic", "herb", "produce"],         category: "Produce" },
        { keywords: ["milk", "cheese", "yogurt", "butter", "cream", "egg",
                     "dairy"],                                                     category: "Dairy & Eggs" },
        { keywords: ["chicken", "beef", "pork", "turkey", "fish", "salmon",
                     "shrimp", "meat", "steak", "bacon", "sausage"],              category: "Meat & Seafood" },
        { keywords: ["bread", "bagel", "roll", "bun", "muffin", "tortilla",
                     "wrap", "pita", "bakery"],                                    category: "Bakery & Bread" },
        { keywords: ["pasta", "rice", "cereal", "oat", "flour", "sugar",
                     "oil", "vinegar", "sauce", "soup", "can", "bean",
                     "lentil", "grain"],                                           category: "Pantry" },
        { keywords: ["juice", "soda", "water", "coffee", "tea", "drink",
                     "beverage", "beer", "wine"],                                  category: "Beverages" },
        { keywords: ["soap", "shampoo", "detergent", "cleaner", "tissue",
                     "toilet", "paper towel", "trash bag", "household"],           category: "Household" },
        { keywords: ["vitamin", "medicine", "bandage", "pharmacy"],               category: "Health" },
    ],

    GROCERY_CATEGORY_ORDER: [
        "Produce",
        "Dairy & Eggs",
        "Meat & Seafood",
        "Bakery & Bread",
        "Frozen",
        "Pantry",
        "Snacks",
        "Beverages",
        "Household",
        "Health",
    ],

    // ==================== DINNER SUGGESTIONS ====================
    OLLAMA_URL: "http://192.168.1.87:11434",
    OLLAMA_MODEL: "llama3.1",
    DINNER_REFRESH_HOURS: 24,
    DINNER_ENTITY: "sensor.dinner_suggestions",

    // ==================== NOTIFICATION DEVICES ====================
    NOTIFY_DEVICES: [
        { name: "Devin's Phone", service: "notify.mobile_app_devin_s_phone" },
        { name: "Megan's Phone", service: "notify.mobile_app_megan_s_phone" },
        { name: "iPad",          service: "notify.mobile_app_ipad" },
    ],

    // ==================== DISPLAY SETTINGS ====================
    PLANNER_DAYS: 3,

    // ==================== CACHE DURATIONS (seconds) ====================
    CACHE_DURATION: {
        weather: 60,
        theme: 300,
        forecast: 300,
        shopping: 30,
        dinner: 300,
    },
};
