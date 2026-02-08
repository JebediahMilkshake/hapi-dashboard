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

# ==================== DISPLAY SETTINGS ====================
PLANNER_DAYS = 7                   # Number of days to show in planner (1-14)