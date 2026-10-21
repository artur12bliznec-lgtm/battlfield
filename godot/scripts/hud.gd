class_name Hud
extends CanvasLayer
## Интерфейс боя: прицел с отметкой попадания, патроны, ячейки инвентаря,
## расстояние до точки захвата, окно инвентаря (Tab) и пауза (Esc). Время,
## захват, здоровье и итог боя рисует ModeHud (режим «Удержание»).

const GOLD := Color(0.95, 0.75, 0.32)
const PANEL := Color(0.07, 0.08, 0.07, 0.72)

var player: Player
## Режим «Удержание» (если идёт бой).
var mode: HoldMode
var _crosshair: Crosshair
var _scope: Scope
var _ammo: Label
var _weapon_name: Label
var _weapon_info: Label
var _point: Label
var _slots: Array[PanelContainer] = []
var _slot_notes: Array[Label] = []
var _inventory: Control
var _cards: Array[PanelContainer] = []
var _card_notes: Array[Label] = []
var _pause: Control
var _previews: Array[Preview] = []
var _shown_slot := -2


func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	for item in Arsenal.ITEMS:
		var preview := Preview.new()
		preview.sway = false  # покачиваются только в открытом инвентаре
		add_child(preview)
		preview.show_model(Arsenal.scene(item).instantiate())
		_previews.append(preview)
	_scope = Scope.new()
	_fill(_scope)
	_scope.visible = false
	add_child(_scope)
	_crosshair = Crosshair.new()
	_fill(_crosshair)
	add_child(_crosshair)
	_build_top()
	_build_hotbar()
	_build_ammo()
	_inventory = _build_inventory()
	_pause = _build_pause()
	if mode:
		var mode_hud := ModeHud.new()
		mode_hud.player = player
		mode_hud.mode = mode
		add_child(mode_hud)
		move_child(mode_hud, _inventory.get_index())  # под инвентарём и паузой
		mode.finished.connect(_on_finished)
	player.hit_enemy.connect(_on_hit_enemy)


func _input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if not key or not key.pressed or key.echo:
		return
	if mode and mode.over:
		return  # бой окончен — только кнопки итога
	if key.physical_keycode == KEY_ESCAPE:
		if _inventory.visible:
			_show_inventory(false)
		else:
			_show_pause(not _pause.visible)
		get_viewport().set_input_as_handled()
	elif key.physical_keycode == KEY_TAB or key.physical_keycode == KEY_I:
		if not _pause.visible:
			_show_inventory(not _inventory.visible)
		get_viewport().set_input_as_handled()


func _process(delta: float) -> void:
	if not player:
		return
	_crosshair.hit = maxf(0.0, _crosshair.hit - delta)
	var item: Dictionary = player.items[player.slot]
	_weapon_name.text = item.name
	_ammo.text = "%d / %d" % [item.ammo, item.reserve]
	_weapon_info.text = "%s · %s" % [item.caliber, item.modes]
	if player.action == "reload":
		_weapon_info.text = "перезарядка…"
	elif item.ammo == 0:
		_weapon_info.text = "пусто — R, перезарядка"

	if player.on_point:
		_point.text = "ВЫ НА ТОЧКЕ ЗАХВАТА"
	else:
		var flat := Vector2(player.global_position.x, player.global_position.z)
		_point.text = "Точка захвата · %d м" % roundi(flat.length())

	var scoped := player.is_scoped()
	_scope.visible = scoped and not _inventory.visible
	_crosshair.visible = not scoped and not player.blocked and not player.sprinting and player.alive
	_crosshair.gap = 7.0 + Vector2(player.velocity.x, player.velocity.z).length() * 3.0
	if player.aiming:
		_crosshair.gap *= 0.5
	_crosshair.queue_redraw()

	if _shown_slot != player.slot:
		_shown_slot = player.slot
		for i in _slots.size():
			_slots[i].add_theme_stylebox_override("panel", _style(i == player.slot))
	_slot_notes[5].text = "×%d" % player.items[5].count
	for i in 5:
		var state: Dictionary = player.items[i]
		_slot_notes[i].text = "%d / %d" % [state.ammo, state.reserve]
	if _inventory.visible:
		for i in _cards.size():
			var state: Dictionary = player.items[i]
			if state.kind == "item":
				_card_notes[i].text = "Осталось: %d" % state.count
			else:
				_card_notes[i].text = "Патроны: %d / %d" % [state.ammo, state.reserve]


# --- построение ---------------------------------------------------------


func _build_top() -> void:
	var team: Dictionary = Game.TEAMS[player.team]
	var badge := _label("%s · Город · «Удержание»" % team.name, 18, team.color)
	_place(badge, Control.PRESET_TOP_LEFT, Rect2(20, 14, 600, 30))
	add_child(badge)
	_point = _label("", 18, GOLD)
	_point.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	_place(_point, Control.PRESET_TOP_RIGHT, Rect2(-420, 14, 400, 30))
	add_child(_point)
	var hint := _label("Tab — инвентарь · Esc — пауза", 15, Color(1, 1, 1, 0.85))
	_place(hint, Control.PRESET_BOTTOM_LEFT, Rect2(20, -40, 500, 26))
	add_child(hint)


func _build_hotbar() -> void:
	var bar := HBoxContainer.new()
	bar.alignment = BoxContainer.ALIGNMENT_CENTER
	bar.add_theme_constant_override("separation", 8)
	_place(bar, Control.PRESET_CENTER_BOTTOM, Rect2(-500, -128, 1000, 116))
	add_child(bar)
	for i in Arsenal.ITEMS.size():
		var item: Dictionary = Arsenal.ITEMS[i]
		var panel := PanelContainer.new()
		panel.custom_minimum_size = Vector2(150, 110)
		panel.add_theme_stylebox_override("panel", _style(false))
		var box := VBoxContainer.new()
		box.add_theme_constant_override("separation", 0)
		panel.add_child(box)
		var icon := TextureRect.new()
		icon.texture = _previews[i].get_texture()
		icon.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
		icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
		icon.custom_minimum_size = Vector2(140, 66)
		box.add_child(icon)
		var title := _label("%d  %s" % [i + 1, item.get("short", item.name)], 13, Color.WHITE)
		title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		title.clip_text = true
		box.add_child(title)
		var note := _label("", 12, Color(1, 1, 1, 0.7))
		note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		box.add_child(note)
		_slot_notes.append(note)
		bar.add_child(panel)
		_slots.append(panel)


func _build_ammo() -> void:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _style(false))
	_place(panel, Control.PRESET_BOTTOM_RIGHT, Rect2(-300, -128, 280, 116))
	add_child(panel)
	var box := VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	panel.add_child(box)
	_weapon_name = _label("", 18, Color.WHITE)
	_weapon_name.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	box.add_child(_weapon_name)
	_ammo = _label("", 36, GOLD)
	_ammo.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	box.add_child(_ammo)
	_weapon_info = _label("", 13, Color(1, 1, 1, 0.75))
	_weapon_info.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	box.add_child(_weapon_info)


func _build_inventory() -> Control:
	var screen := Control.new()
	_fill(screen)
	screen.mouse_filter = Control.MOUSE_FILTER_STOP
	screen.visible = false
	add_child(screen)
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.62)
	_fill(dim)
	screen.add_child(dim)

	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 14)
	_center(column)
	screen.add_child(column)
	var title := _label("Инвентарь", 34, GOLD)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(title)
	var tip := _label(
		"Щёлкните карточку, чтобы взять оружие · Tab — закрыть", 15, Color(1, 1, 1, 0.8)
	)
	tip.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(tip)

	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 14)
	grid.add_theme_constant_override("v_separation", 14)
	column.add_child(grid)
	for i in Arsenal.ITEMS.size():
		grid.add_child(_card(i))
	return screen


func _card(index: int) -> PanelContainer:
	var item: Dictionary = Arsenal.ITEMS[index]
	var card := PanelContainer.new()
	card.custom_minimum_size = Vector2(340, 0)
	card.add_theme_stylebox_override("panel", _style(false))
	card.mouse_filter = Control.MOUSE_FILTER_STOP
	card.gui_input.connect(_on_card_input.bind(index))
	card.mouse_entered.connect(
		func() -> void: card.add_theme_stylebox_override("panel", _style(true))
	)
	card.mouse_exited.connect(
		func() -> void: card.add_theme_stylebox_override("panel", _style(false))
	)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 4)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	card.add_child(box)

	var view := TextureRect.new()
	view.texture = _previews[index].get_texture()
	view.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	view.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	view.custom_minimum_size = Vector2(320, 150)
	view.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(view)
	var name_label := _label("%d · %s" % [index + 1, item.name], 20, Color.WHITE)
	box.add_child(name_label)
	var about := _label(item.about, 13, Color(1, 1, 1, 0.78))
	about.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	about.custom_minimum_size = Vector2(320, 0)
	box.add_child(about)
	var stats := GridContainer.new()
	stats.columns = 2
	stats.add_theme_constant_override("h_separation", 16)
	stats.mouse_filter = Control.MOUSE_FILTER_IGNORE
	for row in Arsenal.stats(item):
		stats.add_child(_label(row[0], 13, Color(1, 1, 1, 0.6)))
		stats.add_child(_label(row[1], 13, Color.WHITE))
	box.add_child(stats)
	var note := _label("", 14, GOLD)
	box.add_child(note)
	_cards.append(card)
	_card_notes.append(note)
	return card


func _build_pause() -> Control:
	var screen := Control.new()
	_fill(screen)
	screen.mouse_filter = Control.MOUSE_FILTER_STOP
	screen.visible = false
	add_child(screen)
	var dim := ColorRect.new()
	dim.color = Color(0, 0, 0, 0.66)
	_fill(dim)
	screen.add_child(dim)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 12)
	_center(column)
	screen.add_child(column)
	var title := _label("Пауза", 40, GOLD)
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(title)
	var actions := [
		["Продолжить", func() -> void: _show_pause(false)],
		["Сменить команду", func() -> void: Game.choose_team()],
		["Главное меню", func() -> void: Game.menu()],
		["Выход из игры", func() -> void: get_tree().quit()],
	]
	for entry in actions:
		var button := Button.new()
		button.text = entry[0]
		button.custom_minimum_size = Vector2(380, 46)
		button.add_theme_font_size_override("font_size", 19)
		button.pressed.connect(entry[1])
		column.add_child(button)
	var help := _label(
		(
			"WASD — двигаться · Shift — спринт · C — присесть · Z — лечь · Пробел — прыжок\n"
			+ "ЛКМ — стрелять · ПКМ — целиться · R — перезарядка · 1–5, колесо — оружие\n"
			+ "6 или H — перевязка · Tab — инвентарь"
		),
		14,
		Color(1, 1, 1, 0.75)
	)
	help.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(help)
	return screen


# --- поведение ----------------------------------------------------------


func _show_inventory(on: bool) -> void:
	_inventory.visible = on
	for preview in _previews:
		preview.sway = on
	player.blocked = on
	player.aiming = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE if on else Input.MOUSE_MODE_CAPTURED


func _show_pause(on: bool) -> void:
	_pause.visible = on
	get_tree().paused = on
	player.blocked = on
	player.aiming = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE if on else Input.MOUSE_MODE_CAPTURED


## Бой окончен: итог (ModeHud) лежит под инвентарём — закрыть инвентарь.
func _on_finished(_won: bool) -> void:
	_inventory.visible = false
	for preview in _previews:
		preview.sway = false
	player.blocked = true
	player.aiming = false
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


## Попали по врагу — белая отметка в прицеле, убили — красная.
func _on_hit_enemy(kill: bool) -> void:
	_crosshair.hit = 0.25
	_crosshair.kill = kill
	Sfx.play(self, "hitmarker", -10.0 if not kill else -6.0, 1.0 if not kill else 0.8)


func _on_card_input(event: InputEvent, index: int) -> void:
	var click := event as InputEventMouseButton
	# по отпусканию: иначе ещё зажатая ЛКМ сразу даст очередь из автомата
	if not click or click.pressed or click.button_index != MOUSE_BUTTON_LEFT:
		return
	_show_inventory(false)
	if index == 5:
		player.bandage()
	else:
		player.equip(index)


# --- помощники ----------------------------------------------------------


func _label(text: String, font_size: int, color: Color) -> Label:
	var label := Label.new()
	label.text = text
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	label.add_theme_constant_override("outline_size", 5)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	return label


func _style(active: bool) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = PANEL
	style.border_color = GOLD if active else Color(1, 1, 1, 0.12)
	style.set_border_width_all(2)
	style.set_corner_radius_all(6)
	style.set_content_margin_all(8)
	return style


## Растянуть на весь экран.
func _fill(control: Control) -> void:
	control.set_anchors_preset(Control.PRESET_FULL_RECT)
	control.mouse_filter = Control.MOUSE_FILTER_IGNORE


## Поставить по центру экрана (размер — по содержимому).
func _center(control: Control) -> void:
	control.set_anchors_preset(Control.PRESET_CENTER)
	control.grow_horizontal = Control.GROW_DIRECTION_BOTH
	control.grow_vertical = Control.GROW_DIRECTION_BOTH


## Привязать к краю экрана: rect — смещения от точки привязки.
func _place(control: Control, preset: Control.LayoutPreset, rect: Rect2) -> void:
	control.set_anchors_preset(preset)
	control.offset_left = rect.position.x
	control.offset_top = rect.position.y
	control.offset_right = rect.end.x
	control.offset_bottom = rect.end.y


## Перекрестие: четыре штриха, расходятся на бегу.
class Crosshair:
	extends Control
	var gap := 7.0
	## Отметка попадания: сколько ещё показывать (с) и было ли это убийство.
	var hit := 0.0
	var kill := false

	func _draw() -> void:
		var c := size * 0.5
		for d in [Vector2.RIGHT, Vector2.LEFT, Vector2.UP, Vector2.DOWN]:
			draw_line(c + d * gap, c + d * (gap + 9.0), Color(0, 0, 0, 0.55), 4.0)
			draw_line(c + d * gap, c + d * (gap + 9.0), Color(1, 1, 1, 0.92), 2.0)
		draw_circle(c, 1.6, Color(1, 1, 1, 0.92))
		if hit > 0.0:
			var color := Color(1, 0.25, 0.2, hit * 4.0) if kill else Color(1, 1, 1, hit * 4.0)
			for d in [Vector2(1, 1), Vector2(-1, 1), Vector2(1, -1), Vector2(-1, -1)]:
				draw_line(c + d * 6.0, c + d * 13.0, color, 2.5)


## Оптический прицел снайперки: чёрная рамка с круглым окном и сеткой.
class Scope:
	extends Control

	func _draw() -> void:
		var c := size * 0.5
		var r := size.y * 0.42
		var outer := size.length()
		draw_arc(c, (r + outer) * 0.5, 0.0, TAU, 96, Color.BLACK, outer - r)
		draw_arc(c, r, 0.0, TAU, 96, Color(0, 0, 0, 0.9), 6.0)
		var ink := Color(0, 0, 0, 0.85)
		draw_line(c - Vector2(r, 0), c + Vector2(r, 0), ink, 1.5)
		draw_line(c - Vector2(0, r), c + Vector2(0, r), ink, 1.5)
		draw_line(c - Vector2(r, 0), c - Vector2(r * 0.15, 0), Color.BLACK, 5.0)
		draw_line(c + Vector2(r * 0.15, 0), c + Vector2(r, 0), Color.BLACK, 5.0)
		draw_line(c + Vector2(0, r * 0.15), c + Vector2(0, r), Color.BLACK, 5.0)
		for k in range(1, 5):
			var y := r * 0.07 * k
			draw_line(c + Vector2(-6 + k, y), c + Vector2(6 - k, y), ink, 1.5)
