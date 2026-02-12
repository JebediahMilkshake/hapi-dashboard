# Dashboard Configuration File
# Edit this file to customize your calendar dashboard

# ==================== HOME ASSISTANT CONNECTION ====================
HA_URL = "http://192.168.1.113:8123"
HA_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiI0MGZiZTM4NWQ2MGI0YzIwODExZWVhYjExZjZhOWVhNCIsImlhdCI6MTc3MDQ5OTMxMywiZXhwIjoyMDg1ODU5MzEzfQ.o5fivSvhvrgDrrZncOBpq0xx_Le3hpfGDj-A2s0b4jk"

# ==================== WEATHER ====================
WEATHER_ENTITY = "weather.forecast_home"  # Your weather entity ID


# ==================== CALENDARS ====================
# Add your calendar entities with display names and colors
CALENDARS = [
    {
        "entity": "calendar.devin_g_lanz1_gmail_com",
        "name": "Devin", 
	"color_dark": "#51cf66",      # Green
        "color_light": "#388E3C",     # Darker green
	"priority": 3
    },
    {
        "entity": "calendar.mearley046_gmail_com",
        "name": "Megan",
        "color_dark": "#ff6b6b",      # Red
        "color_light": "#D32F2F",     # Darker red
	"priority": 3
    },
    {
        "entity": "calendar.republic_services",
        "name": "Trash",
        "color_dark": "#4a9eff",      # Blue - for dark theme
        "color_light": "#1976D2",     # Darker blue - for light theme
	"priority": 2
    },
    {
        "entity": "calendar.holidays_in_united_states",
        "name": "Holidays",
        "color_dark": "#FFD700",     # Gold
        "color_light": "#DAA520",    # Goldenrod
	"priority": 2
    },
    {
        "entity": "calendar.birthdays",
        "name": "Birthdays",
        "color_dark": "#E91E63",      # Pink
        "color_light": "#C2185B",     # Dark Pink
	"priority": 1
    }
]

# ==================== THEME SETTINGS ====================
# Theme control entity in Home Assistant
THEME_ENTITY = "input_boolean.calendar_dashboard_dark_mode"

# Screen blanking control entity (set to 'on' to blank screen)
SCREEN_BLANK_ENTITY = "input_boolean.calendar_dashboard_blank_screen"

# ==================== SHOPPING LIST ====================
# Home Assistant todo entity for the grocery/shopping list
SHOPPING_LIST_ENTITY = "todo.shopping_list"

# Category rules: first matching keyword wins. Order matters — put specific
# compound terms (e.g. "frozen") before broad ones (e.g. "vegetable").
# All comparisons are case-insensitive substring matches.
GROCERY_CATEGORIES = [
    {"keywords": ["frozen"],                                          "category": "Frozen"},
    {"keywords": ["chip", "cracker", "pretzel", "snack", "popcorn"], "category": "Snacks"},
    {"keywords": ["apple", "banana", "berry", "grape", "lemon", "lime",
                  "orange", "peach", "pear", "strawberr", "tomato",
                  "lettuce", "spinach", "carrot", "celery", "onion",
                  "potato", "broccoli", "pepper", "cucumber", "zucchini",
                  "avocado", "mushroom", "garlic", "herb", "produce"],  "category": "Produce"},
    {"keywords": ["milk", "cheese", "yogurt", "butter", "cream", "egg",
                  "dairy"],                                             "category": "Dairy & Eggs"},
    {"keywords": ["chicken", "beef", "pork", "turkey", "fish", "salmon",
                  "shrimp", "meat", "steak", "bacon", "sausage"],       "category": "Meat & Seafood"},
    {"keywords": ["bread", "bagel", "roll", "bun", "muffin", "tortilla",
                  "wrap", "pita", "bakery"],                            "category": "Bakery & Bread"},
    {"keywords": ["pasta", "rice", "cereal", "oat", "flour", "sugar",
                  "oil", "vinegar", "sauce", "soup", "can", "bean",
                  "lentil", "grain"],                                   "category": "Pantry"},
    {"keywords": ["juice", "soda", "water", "coffee", "tea", "drink",
                  "beverage", "beer", "wine"],                          "category": "Beverages"},
    {"keywords": ["soap", "shampoo", "detergent", "cleaner", "tissue",
                  "toilet", "paper towel", "trash bag", "household"],   "category": "Household"},
    {"keywords": ["vitamin", "medicine", "bandage", "pharmacy"],        "category": "Health"},
]

# Controls the display order of categories in the grocery panel.
# Any category not listed here is appended alphabetically; "Other" is always last.
GROCERY_CATEGORY_ORDER = [
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
]

# ==================== DISPLAY SETTINGS ====================
PLANNER_DAYS = 3                   # Number of days to show in planner (1-14)
