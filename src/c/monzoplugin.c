#include <pebble.h>

#define MAX_ACCOUNTS 4
#define STORAGE_KEY_THEME 100

typedef struct {
  char id[40];
  char name[24];
  char balance[24];
  char spend[36];
  char total[36];
  char pots[64];
} AccountItem;

static AccountItem s_accounts[MAX_ACCOUNTS];
static int s_account_count = 2;
static int s_selected_account_idx = 0;
static char s_status_buffer[24] = "Ready";
static int s_theme = 0; // 0 = Light (Default), 1 = Dark

// Main Window Elements
static Window *s_main_window;
#if !defined(PBL_ROUND)
static Layer *s_header_bar_layer;
#endif
static TextLayer *s_header_title_layer;
static TextLayer *s_header_status_layer;
static TextLayer *s_balance_label_layer;
static TextLayer *s_balance_layer;
static Layer *s_pill_layer;
static TextLayer *s_spend_today_layer;
static Layer *s_dots_layer;

// Detail Window Elements (MenuLayer)
static Window *s_detail_window;
static MenuLayer *s_menu_layer;

// ---------------------------------------------------------------- Theme Helpers

static void prv_apply_theme(void) {
  bool is_light = (s_theme == 0);

  if (s_main_window) {
    window_set_background_color(s_main_window, is_light ? GColorWhite : GColorBlack);
  }

#if defined(PBL_ROUND)
  if (s_header_title_layer) {
    text_layer_set_text_color(s_header_title_layer, is_light ?
      PBL_IF_COLOR_ELSE(GColorSunsetOrange, GColorBlack) :
      PBL_IF_COLOR_ELSE(GColorSunsetOrange, GColorWhite));
  }
  if (s_header_status_layer) {
    text_layer_set_text_color(s_header_status_layer, is_light ?
      PBL_IF_COLOR_ELSE(GColorDarkGray, GColorBlack) :
      PBL_IF_COLOR_ELSE(GColorLightGray, GColorWhite));
  }
#else
  if (s_header_title_layer) {
    text_layer_set_text_color(s_header_title_layer, GColorWhite);
  }
  if (s_header_status_layer) {
    text_layer_set_text_color(s_header_status_layer, is_light ?
      GColorWhite :
      PBL_IF_COLOR_ELSE(GColorLightGray, GColorWhite));
  }
  if (s_header_bar_layer) {
    layer_mark_dirty(s_header_bar_layer);
  }
#endif

  if (s_balance_label_layer) {
    text_layer_set_text_color(s_balance_label_layer, is_light ?
      PBL_IF_COLOR_ELSE(GColorDarkGray, GColorBlack) :
      PBL_IF_COLOR_ELSE(GColorSunsetOrange, GColorWhite));
  }

  if (s_balance_layer) {
    text_layer_set_text_color(s_balance_layer, is_light ?
      GColorBlack :
      GColorWhite);
  }

  if (s_spend_today_layer) {
    text_layer_set_text_color(s_spend_today_layer, is_light ?
      GColorBlack :
      PBL_IF_COLOR_ELSE(GColorMintGreen, GColorWhite));
  }

  if (s_pill_layer) {
    layer_mark_dirty(s_pill_layer);
  }

  if (s_dots_layer) {
    layer_mark_dirty(s_dots_layer);
  }
}

// ---------------------------------------------------------------- Display Updates

static void prv_update_main_display(void) {
  if (s_account_count <= 0) s_account_count = 1;
  if (s_selected_account_idx >= s_account_count) s_selected_account_idx = 0;

  AccountItem *acc = &s_accounts[s_selected_account_idx];

  // Header Title
  text_layer_set_text(s_header_title_layer, acc->name[0] ? acc->name : "MONZO");

  // Header Status: Page indicator like "1/2" or status string
  static char s_page_indicator[24];
  if (s_account_count > 1) {
    snprintf(s_page_indicator, sizeof(s_page_indicator), "%d/%d", s_selected_account_idx + 1, s_account_count);
    text_layer_set_text(s_header_status_layer, s_page_indicator);
  } else {
    text_layer_set_text(s_header_status_layer, s_status_buffer);
  }

  // Dynamic Font Scaling for Spendable Balance
  if (strlen(acc->balance) > 9) {
    text_layer_set_font(s_balance_layer, fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD));
  } else {
    text_layer_set_font(s_balance_layer, fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD));
  }
  text_layer_set_text(s_balance_layer, acc->balance);

  // Spent Today or Action status
  static char s_spend_text[64];
  if (strncmp(acc->spend, "£", 2) == 0 || strncmp(acc->spend, "$", 1) == 0 ||
      strncmp(acc->spend, "€", 3) == 0 || (acc->spend[0] >= '0' && acc->spend[0] <= '9')) {
    snprintf(s_spend_text, sizeof(s_spend_text), "Today: %s", acc->spend);
  } else {
    snprintf(s_spend_text, sizeof(s_spend_text), "%s", acc->spend);
  }
  text_layer_set_text(s_spend_today_layer, s_spend_text);

  if (s_dots_layer) {
    layer_mark_dirty(s_dots_layer);
  }
}

// ---------------------------------------------------------------- Custom Draw Procedures

#if !defined(PBL_ROUND)
static void prv_header_bar_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  bool is_light = (s_theme == 0);

  if (is_light) {
    // Light theme: Monzo Coral banner on color, solid black on monochrome
    graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorSunsetOrange, GColorBlack));
    graphics_fill_rect(ctx, bounds, 0, GCornerNone);
  } else {
    // Dark theme: Dark navy banner with subtle coral underline
    graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorOxfordBlue, GColorBlack));
    graphics_fill_rect(ctx, bounds, 0, GCornerNone);
    graphics_context_set_stroke_color(ctx, PBL_IF_COLOR_ELSE(GColorSunsetOrange, GColorWhite));
    graphics_context_set_stroke_width(ctx, 1);
    graphics_draw_line(ctx, GPoint(0, bounds.size.h - 1), GPoint(bounds.size.w, bounds.size.h - 1));
  }
}
#endif

static void prv_pill_update_proc(Layer *layer, GContext *ctx) {
  GRect bounds = layer_get_bounds(layer);
  bool is_light = (s_theme == 0);
  int16_t corner_radius = bounds.size.h / 2;

  if (is_light) {
    // Light theme: Soft pastel background with subtle coral/dark border
    graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorPastelYellow, GColorWhite));
    graphics_fill_rect(ctx, bounds, corner_radius, GCornersAll);
    graphics_context_set_stroke_color(ctx, PBL_IF_COLOR_ELSE(GColorSunsetOrange, GColorBlack));
    graphics_context_set_stroke_width(ctx, 1);
    graphics_draw_round_rect(ctx, bounds, corner_radius);
  } else {
    // Dark theme: Dark navy pill with coral border
    graphics_context_set_fill_color(ctx, PBL_IF_COLOR_ELSE(GColorOxfordBlue, GColorBlack));
    graphics_fill_rect(ctx, bounds, corner_radius, GCornersAll);
    graphics_context_set_stroke_color(ctx, PBL_IF_COLOR_ELSE(GColorSunsetOrange, GColorWhite));
    graphics_context_set_stroke_width(ctx, 1);
    graphics_draw_round_rect(ctx, bounds, corner_radius);
  }
}

static void prv_dots_update_proc(Layer *layer, GContext *ctx) {
  if (s_account_count <= 1) return;
  GRect bounds = layer_get_bounds(layer);
  bool is_light = (s_theme == 0);

  int spacing = 12;
  int radius = 3;
  int total_width = (s_account_count - 1) * spacing;
  int start_x = (bounds.size.w - total_width) / 2;
  int center_y = bounds.size.h / 2;

  for (int i = 0; i < s_account_count; i++) {
    GPoint center = GPoint(start_x + (i * spacing), center_y);
    if (i == s_selected_account_idx) {
      graphics_context_set_fill_color(ctx, is_light ?
        PBL_IF_COLOR_ELSE(GColorSunsetOrange, GColorBlack) :
        PBL_IF_COLOR_ELSE(GColorSunsetOrange, GColorWhite));
      graphics_fill_circle(ctx, center, radius);
    } else {
      graphics_context_set_stroke_color(ctx, is_light ?
        PBL_IF_COLOR_ELSE(GColorLightGray, GColorBlack) :
        PBL_IF_COLOR_ELSE(GColorDarkGray, GColorWhite));
      graphics_draw_circle(ctx, center, radius);
    }
  }
}

// ---------------------------------------------------------------- Detail MenuLayer

static uint16_t prv_menu_get_num_sections(MenuLayer *menu_layer, void *data) {
  return 1;
}

static uint16_t prv_menu_get_num_rows(MenuLayer *menu_layer, uint16_t section_index, void *data) {
  return 5;
}

static int16_t prv_menu_get_header_height(MenuLayer *menu_layer, uint16_t section_index, void *data) {
  return MENU_CELL_BASIC_HEADER_HEIGHT;
}

static void prv_menu_draw_header(GContext *ctx, const Layer *cell_layer, uint16_t section_index, void *data) {
  AccountItem *acc = &s_accounts[s_selected_account_idx];
  static char s_hdr_text[32];
  snprintf(s_hdr_text, sizeof(s_hdr_text), "%s DETAILS", acc->name[0] ? acc->name : "MONZO");
  menu_cell_basic_header_draw(ctx, cell_layer, s_hdr_text);
}

static void prv_menu_draw_row(GContext *ctx, const Layer *cell_layer, MenuIndex *cell_index, void *data) {
  AccountItem *acc = &s_accounts[s_selected_account_idx];

  switch (cell_index->row) {
    case 0:
      menu_cell_basic_draw(ctx, cell_layer, "Spendable Balance", acc->balance, NULL);
      break;
    case 1:
      menu_cell_basic_draw(ctx, cell_layer, "Spent Today", acc->spend, NULL);
      break;
    case 2:
      menu_cell_basic_draw(ctx, cell_layer, "Total Wealth", acc->total, NULL);
      break;
    case 3:
      menu_cell_basic_draw(ctx, cell_layer, "Savings Pots", acc->pots, NULL);
      break;
    case 4:
      menu_cell_basic_draw(ctx, cell_layer, "Account ID", acc->id[0] ? acc->id : "Unknown", NULL);
      break;
  }
}

static void prv_detail_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

  s_menu_layer = menu_layer_create(bounds);
  menu_layer_set_callbacks(s_menu_layer, NULL, (MenuLayerCallbacks) {
    .get_num_sections = prv_menu_get_num_sections,
    .get_num_rows = prv_menu_get_num_rows,
    .get_header_height = prv_menu_get_header_height,
    .draw_header = prv_menu_draw_header,
    .draw_row = prv_menu_draw_row,
  });

  bool is_light = (s_theme == 0);
  GColor bg = is_light ? GColorWhite : GColorBlack;
  GColor fg = is_light ? GColorBlack : GColorWhite;
  GColor highlight_bg = PBL_IF_COLOR_ELSE(GColorSunsetOrange, is_light ? GColorBlack : GColorWhite);
  GColor highlight_fg = PBL_IF_COLOR_ELSE(GColorWhite, is_light ? GColorWhite : GColorBlack);

  menu_layer_set_normal_colors(s_menu_layer, bg, fg);
  menu_layer_set_highlight_colors(s_menu_layer, highlight_bg, highlight_fg);

#if defined(PBL_ROUND)
  menu_layer_set_center_focused(s_menu_layer, true);
#endif

  menu_layer_set_click_config_onto_window(s_menu_layer, window);
  layer_add_child(window_layer, menu_layer_get_layer(s_menu_layer));
}

static void prv_detail_window_unload(Window *window) {
  menu_layer_destroy(s_menu_layer);
  s_menu_layer = NULL;
}

// ---------------------------------------------------------------- Actions & Refresh

static void prv_trigger_sync(void) {
  DictionaryIterator *iter;
  AppMessageResult res = app_message_outbox_begin(&iter);
  if (res == APP_MSG_OK) {
    dict_write_int32(iter, MESSAGE_KEY_KEY_REQUEST_TYPE, 1);
    app_message_outbox_send();
    snprintf(s_status_buffer, sizeof(s_status_buffer), "Syncing…");
    text_layer_set_text(s_header_status_layer, s_status_buffer);
    vibes_short_pulse();
  } else {
    APP_LOG(APP_LOG_LEVEL_WARNING, "Outbox begin failed: %d", (int)res);
  }
}

static void prv_select_click_handler(ClickRecognizerRef recognizer, void *context) {
  // Short click -> Open Detail Screen
  if (!s_detail_window) {
    s_detail_window = window_create();
    window_set_window_handlers(s_detail_window, (WindowHandlers) {
      .load = prv_detail_window_load,
      .unload = prv_detail_window_unload,
    });
  }
  window_stack_push(s_detail_window, true);
}

static void prv_select_long_click_handler(ClickRecognizerRef recognizer, void *context) {
  // Long press -> Refresh / Sync
  prv_trigger_sync();
}

static void prv_up_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_account_count > 1) {
    s_selected_account_idx = (s_selected_account_idx - 1 + s_account_count) % s_account_count;
    prv_update_main_display();
  }
}

static void prv_down_click_handler(ClickRecognizerRef recognizer, void *context) {
  if (s_account_count > 1) {
    s_selected_account_idx = (s_selected_account_idx + 1) % s_account_count;
    prv_update_main_display();
  }
}

static void prv_click_config_provider(void *context) {
  window_single_click_subscribe(BUTTON_ID_SELECT, prv_select_click_handler);
  window_long_click_subscribe(BUTTON_ID_SELECT, 500, prv_select_long_click_handler, NULL);
  window_single_click_subscribe(BUTTON_ID_UP, prv_up_click_handler);
  window_single_click_subscribe(BUTTON_ID_DOWN, prv_down_click_handler);
}

// ---------------------------------------------------------------- Main Window Load

static void prv_main_window_load(Window *window) {
  Layer *window_layer = window_get_root_layer(window);
  GRect bounds = layer_get_bounds(window_layer);

#if defined(PBL_ROUND)
  // Chalk / Gabbro circular screen
  int16_t screen_w = bounds.size.w;

  s_header_title_layer = text_layer_create(GRect(20, 20, screen_w - 40, 20));
  text_layer_set_background_color(s_header_title_layer, GColorClear);
  text_layer_set_font(s_header_title_layer, fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD));
  text_layer_set_text_alignment(s_header_title_layer, GTextAlignmentCenter);
  layer_add_child(window_layer, text_layer_get_layer(s_header_title_layer));

  s_header_status_layer = text_layer_create(GRect(30, 40, screen_w - 60, 16));
  text_layer_set_background_color(s_header_status_layer, GColorClear);
  text_layer_set_font(s_header_status_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14));
  text_layer_set_text_alignment(s_header_status_layer, GTextAlignmentCenter);
  layer_add_child(window_layer, text_layer_get_layer(s_header_status_layer));

  s_balance_label_layer = text_layer_create(GRect(20, 58, screen_w - 40, 16));
  text_layer_set_background_color(s_balance_label_layer, GColorClear);
  text_layer_set_font(s_balance_label_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD));
  text_layer_set_text_alignment(s_balance_label_layer, GTextAlignmentCenter);
  text_layer_set_text(s_balance_label_layer, "SPENDABLE");
  layer_add_child(window_layer, text_layer_get_layer(s_balance_label_layer));

  s_balance_layer = text_layer_create(GRect(10, 74, screen_w - 20, 36));
  text_layer_set_background_color(s_balance_layer, GColorClear);
  text_layer_set_font(s_balance_layer, fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD));
  text_layer_set_text_alignment(s_balance_layer, GTextAlignmentCenter);
  layer_add_child(window_layer, text_layer_get_layer(s_balance_layer));

  int16_t pill_w = 134;
  int16_t pill_h = 24;
  s_pill_layer = layer_create(GRect((screen_w - pill_w) / 2, 114, pill_w, pill_h));
  layer_set_update_proc(s_pill_layer, prv_pill_update_proc);
  layer_add_child(window_layer, s_pill_layer);

  s_spend_today_layer = text_layer_create(GRect(2, 2, pill_w - 4, 20));
  text_layer_set_background_color(s_spend_today_layer, GColorClear);
  text_layer_set_font(s_spend_today_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14));
  text_layer_set_text_alignment(s_spend_today_layer, GTextAlignmentCenter);
  layer_add_child(s_pill_layer, text_layer_get_layer(s_spend_today_layer));

  s_dots_layer = layer_create(GRect(0, 148, screen_w, 16));
  layer_set_update_proc(s_dots_layer, prv_dots_update_proc);
  layer_add_child(window_layer, s_dots_layer);

#else
  // Rectangular screen (Basalt 144x168, Emery 200x228, etc.)
  int16_t screen_w = bounds.size.w;
  bool is_emery = (screen_w > 180);

  int16_t bar_h = is_emery ? 28 : 24;
  int16_t label_y = is_emery ? 44 : 36;
  int16_t bal_y = is_emery ? 68 : 56;
  int16_t bal_h = is_emery ? 42 : 36;
  int16_t pill_w = is_emery ? 160 : 130;
  int16_t pill_h = is_emery ? 28 : 24;
  int16_t pill_y = is_emery ? 128 : 102;
  int16_t dots_y = is_emery ? 186 : 142;

  s_header_bar_layer = layer_create(GRect(0, 0, screen_w, bar_h));
  layer_set_update_proc(s_header_bar_layer, prv_header_bar_update_proc);
  layer_add_child(window_layer, s_header_bar_layer);

  s_header_title_layer = text_layer_create(GRect(8, is_emery ? 3 : 2, screen_w - 56, bar_h - 4));
  text_layer_set_background_color(s_header_title_layer, GColorClear);
  text_layer_set_font(s_header_title_layer, fonts_get_system_font(is_emery ? FONT_KEY_GOTHIC_18_BOLD : FONT_KEY_GOTHIC_14_BOLD));
  layer_add_child(s_header_bar_layer, text_layer_get_layer(s_header_title_layer));

  s_header_status_layer = text_layer_create(GRect(screen_w - 48, is_emery ? 4 : 3, 40, bar_h - 4));
  text_layer_set_background_color(s_header_status_layer, GColorClear);
  text_layer_set_font(s_header_status_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14));
  text_layer_set_text_alignment(s_header_status_layer, GTextAlignmentRight);
  layer_add_child(s_header_bar_layer, text_layer_get_layer(s_header_status_layer));

  s_balance_label_layer = text_layer_create(GRect(0, label_y, screen_w, 18));
  text_layer_set_background_color(s_balance_label_layer, GColorClear);
  text_layer_set_font(s_balance_label_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD));
  text_layer_set_text_alignment(s_balance_label_layer, GTextAlignmentCenter);
  text_layer_set_text(s_balance_label_layer, "SPENDABLE");
  layer_add_child(window_layer, text_layer_get_layer(s_balance_label_layer));

  s_balance_layer = text_layer_create(GRect(0, bal_y, screen_w, bal_h));
  text_layer_set_background_color(s_balance_layer, GColorClear);
  text_layer_set_font(s_balance_layer, fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD));
  text_layer_set_text_alignment(s_balance_layer, GTextAlignmentCenter);
  layer_add_child(window_layer, text_layer_get_layer(s_balance_layer));

  s_pill_layer = layer_create(GRect((screen_w - pill_w) / 2, pill_y, pill_w, pill_h));
  layer_set_update_proc(s_pill_layer, prv_pill_update_proc);
  layer_add_child(window_layer, s_pill_layer);

  s_spend_today_layer = text_layer_create(GRect(2, is_emery ? 4 : 2, pill_w - 4, is_emery ? 22 : 20));
  text_layer_set_background_color(s_spend_today_layer, GColorClear);
  text_layer_set_font(s_spend_today_layer, fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD));
  text_layer_set_text_alignment(s_spend_today_layer, GTextAlignmentCenter);
  layer_add_child(s_pill_layer, text_layer_get_layer(s_spend_today_layer));

  s_dots_layer = layer_create(GRect(0, dots_y, screen_w, 16));
  layer_set_update_proc(s_dots_layer, prv_dots_update_proc);
  layer_add_child(window_layer, s_dots_layer);
#endif

  prv_apply_theme();
  prv_update_main_display();
}

static void prv_main_window_unload(Window *window) {
#if !defined(PBL_ROUND)
  text_layer_destroy(s_header_title_layer);
  text_layer_destroy(s_header_status_layer);
  layer_destroy(s_header_bar_layer);
#else
  text_layer_destroy(s_header_title_layer);
  text_layer_destroy(s_header_status_layer);
#endif
  text_layer_destroy(s_balance_label_layer);
  text_layer_destroy(s_balance_layer);
  text_layer_destroy(s_spend_today_layer);
  layer_destroy(s_pill_layer);
  layer_destroy(s_dots_layer);
}

// ---------------------------------------------------------------- AppMessage Ingestion

static void prv_parse_account_tuple(DictionaryIterator *iter, int index,
                                    uint32_t key_id, uint32_t key_name,
                                    uint32_t key_bal, uint32_t key_spend,
                                    uint32_t key_total, uint32_t key_pots) {
  if (index >= MAX_ACCOUNTS) return;
  AccountItem *acc = &s_accounts[index];

  Tuple *t_id = dict_find(iter, key_id);
  if (t_id) snprintf(acc->id, sizeof(acc->id), "%s", t_id->value->cstring);

  Tuple *t_name = dict_find(iter, key_name);
  if (t_name) snprintf(acc->name, sizeof(acc->name), "%s", t_name->value->cstring);

  Tuple *t_bal = dict_find(iter, key_bal);
  if (t_bal) snprintf(acc->balance, sizeof(acc->balance), "%s", t_bal->value->cstring);

  Tuple *t_spend = dict_find(iter, key_spend);
  if (t_spend) snprintf(acc->spend, sizeof(acc->spend), "%s", t_spend->value->cstring);

  Tuple *t_total = dict_find(iter, key_total);
  if (t_total) snprintf(acc->total, sizeof(acc->total), "%s", t_total->value->cstring);

  Tuple *t_pots = dict_find(iter, key_pots);
  if (t_pots) snprintf(acc->pots, sizeof(acc->pots), "%s", t_pots->value->cstring);
}

static void prv_inbox_received_handler(DictionaryIterator *iter, void *context) {
  Tuple *theme_tuple = dict_find(iter, MESSAGE_KEY_KEY_THEME);
  if (theme_tuple) {
    s_theme = (int)theme_tuple->value->int32;
    persist_write_int(STORAGE_KEY_THEME, s_theme);
    prv_apply_theme();
  }

  Tuple *status_tuple = dict_find(iter, MESSAGE_KEY_KEY_STATUS);
  if (status_tuple) {
    snprintf(s_status_buffer, sizeof(s_status_buffer), "%s", status_tuple->value->cstring);
  }

  Tuple *count_tuple = dict_find(iter, MESSAGE_KEY_KEY_ACCOUNT_COUNT);
  if (count_tuple) {
    s_account_count = (int)count_tuple->value->int32;
    if (s_account_count <= 0) s_account_count = 1;
    if (s_account_count > MAX_ACCOUNTS) s_account_count = MAX_ACCOUNTS;
  }

  prv_parse_account_tuple(iter, 0,
                          MESSAGE_KEY_KEY_ACC0_ID, MESSAGE_KEY_KEY_ACC0_NAME,
                          MESSAGE_KEY_KEY_ACC0_BALANCE, MESSAGE_KEY_KEY_ACC0_SPEND,
                          MESSAGE_KEY_KEY_ACC0_TOTAL, MESSAGE_KEY_KEY_ACC0_POTS);

  prv_parse_account_tuple(iter, 1,
                          MESSAGE_KEY_KEY_ACC1_ID, MESSAGE_KEY_KEY_ACC1_NAME,
                          MESSAGE_KEY_KEY_ACC1_BALANCE, MESSAGE_KEY_KEY_ACC1_SPEND,
                          MESSAGE_KEY_KEY_ACC1_TOTAL, MESSAGE_KEY_KEY_ACC1_POTS);

  prv_parse_account_tuple(iter, 2,
                          MESSAGE_KEY_KEY_ACC2_ID, MESSAGE_KEY_KEY_ACC2_NAME,
                          MESSAGE_KEY_KEY_ACC2_BALANCE, MESSAGE_KEY_KEY_ACC2_SPEND,
                          MESSAGE_KEY_KEY_ACC2_TOTAL, MESSAGE_KEY_KEY_ACC2_POTS);

  prv_parse_account_tuple(iter, 3,
                          MESSAGE_KEY_KEY_ACC3_ID, MESSAGE_KEY_KEY_ACC3_NAME,
                          MESSAGE_KEY_KEY_ACC3_BALANCE, MESSAGE_KEY_KEY_ACC3_SPEND,
                          MESSAGE_KEY_KEY_ACC3_TOTAL, MESSAGE_KEY_KEY_ACC3_POTS);

  prv_update_main_display();

  // If detail window is open, reload menu data
  if (s_detail_window && s_menu_layer) {
    menu_layer_reload_data(s_menu_layer);
  }
}

static void prv_inbox_dropped_handler(AppMessageResult reason, void *context) {
  APP_LOG(APP_LOG_LEVEL_WARNING, "AppMessage dropped: %d", (int)reason);
}

// ---------------------------------------------------------------- Init / Deinit

static void prv_init_defaults(void) {
  s_account_count = 2;

  snprintf(s_accounts[0].id, sizeof(s_accounts[0].id), "acc_personal");
  snprintf(s_accounts[0].name, sizeof(s_accounts[0].name), "PERSONAL");
  snprintf(s_accounts[0].balance, sizeof(s_accounts[0].balance), "£1,245.50");
  snprintf(s_accounts[0].spend, sizeof(s_accounts[0].spend), "£14.20");
  snprintf(s_accounts[0].total, sizeof(s_accounts[0].total), "£3,500.00");
  snprintf(s_accounts[0].pots, sizeof(s_accounts[0].pots), "Savings: £500.00");

  snprintf(s_accounts[1].id, sizeof(s_accounts[1].id), "acc_joint");
  snprintf(s_accounts[1].name, sizeof(s_accounts[1].name), "JOINT");
  snprintf(s_accounts[1].balance, sizeof(s_accounts[1].balance), "£840.20");
  snprintf(s_accounts[1].spend, sizeof(s_accounts[1].spend), "£52.00");
  snprintf(s_accounts[1].total, sizeof(s_accounts[1].total), "£1,200.00");
  snprintf(s_accounts[1].pots, sizeof(s_accounts[1].pots), "Bills: £350.00");
}

static void prv_init(void) {
  s_theme = persist_exists(STORAGE_KEY_THEME) ? persist_read_int(STORAGE_KEY_THEME) : 0;
  prv_init_defaults();

  s_main_window = window_create();
  window_set_click_config_provider(s_main_window, prv_click_config_provider);
  window_set_window_handlers(s_main_window, (WindowHandlers) {
    .load = prv_main_window_load,
    .unload = prv_main_window_unload,
  });

  app_message_register_inbox_received(prv_inbox_received_handler);
  app_message_register_inbox_dropped(prv_inbox_dropped_handler);
  app_message_open(1024, 128);

  const bool animated = true;
  window_stack_push(s_main_window, animated);
}

static void prv_deinit(void) {
  if (s_detail_window) {
    window_destroy(s_detail_window);
    s_detail_window = NULL;
  }
  if (s_main_window) {
    window_destroy(s_main_window);
    s_main_window = NULL;
  }
}

int main(void) {
  prv_init();
  app_event_loop();
  prv_deinit();
}
