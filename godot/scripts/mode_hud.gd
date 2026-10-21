class_name ModeHud
extends Control
## Интерфейс режима «Удержание»: время, полоса захвата точки, силы сторон,
## здоровье, сообщения о волнах и подкреплениях, красные края экрана при
## попадании, экран гибели и итог боя с кнопками.

const RED := Color(0.92, 0.32, 0.26)
const BLUE := Color(0.4, 0.66, 1.0)
const GOLD := Color(0.95, 0.75, 0.32)
const PANEL := Color(0.07, 0.08, 0.07, 0.72)
const MESSAGE_TIME := 3.2

var player: Player
var mode: HoldMode

var _timer: Label
var _bar: ColorRect
var _bar_width := 360.0
var _status: Label
var _forces: Label
var _health_bar: ColorRect
var _health_text: Label
var _vignette: TextureRect
var _message: Label
var _messages: Array = []
var _message_left := 0.0
var _death: Control
var _death_text: Label
var _end: Control
var _end_title: Label
var _end_stats: Label
var _blink := 0.0


func _ready() -> void:
	# уже в дереве: без смещений узел сохранил бы нулевой размер
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	_build_vignette()
	_build_panel()
	_build_health()
	_message = _label("", 22, GOLD)
	_message.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_place(_message, Control.PRESET_CENTER_TOP, Rect2(-400, 128, 800, 34))
	add_child(_message)
	_build_death()
	_build_end()
	mode.message.connect(_on_message)
	mode.finished.connect(_on_finished)
	player.hurt.connect(_on_hurt)


func _process(delta: float) -> void:
	_blink += delta
	var left := ceili(mode.time_left)
	_timer.text = "%d:%02d" % [left / 60, left % 60]
	_timer.add_theme_color_override(
		"font_color", RED if left <= 15 and not mode.over else Color.WHITE
	)
	_bar.size.x = _bar_width * mode.capture / 100.0
	_status.text = _status_text()
	_forces.text = (
		"Союзники: %d · Враги: %d · Уничтожено: %d (ваших %d)"
		% [mode.alive_allies(), mode.alive_enemies(), mode.enemies_killed, mode.player_kills]
	)
	var health := clampf(player.health / Player.MAX_HEALTH, 0.0, 1.0)
	_health_bar.size.x = 240.0 * health
	_health_bar.color = RED if health < 0.35 else Color(0.85, 0.85, 0.8)
	_health_text.text = "Здоровье %d" % ceili(player.health)
	_vignette.modulate.a = maxf(0.0, _vignette.modulate.a - delta * 0.9)
	if not player.alive:
		_vignette.modulate.a = 0.55
	_death.visible = not player.alive and not mode.over
	if _death.visible:
		_death_text.text = "Вы погибли\nснова в бой через %d" % ceili(player.respawn_in())
	_update_message(delta)


func _status_text() -> String:
	var enemies := mode.enemies_on_point
	var defenders := mode.defenders_on_point
	if enemies > 0 and defenders == 0:
		_status.add_theme_color_override("font_color", RED)
		var shown := "Враги захватывают точку! %d %%" % roundi(mode.capture)
		return shown if fmod(_blink, 0.8) < 0.55 else " "
	if enemies > 0:
		_status.add_theme_color_override("font_color", GOLD)
		return "Бой на точке · захват %d %%" % roundi(mode.capture)
	_status.add_theme_color_override("font_color", BLUE)
	if mode.capture > 0.0:
		return "Отбиваем точку · захват %d %%" % roundi(mode.capture)
	return "Точка наша"


func _update_message(delta: float) -> void:
	_message_left -= delta
	if _message_left <= 0.0 and _messages:
		var next: Array = _messages.pop_front()
		_message.text = next[0]
		_message.add_theme_color_override("font_color", next[1])
		_message_left = MESSAGE_TIME
	_message.modulate.a = clampf(_message_left / 0.6, 0.0, 1.0)


func _on_message(text: String, color: Color) -> void:
	_messages.append([text, color])
	if _messages.size() > 3:
		_messages.pop_front()


func _on_hurt(amount: float, _from: Vector3) -> void:
	_vignette.modulate.a = minf(0.9, _vignette.modulate.a + amount / 45.0)


func _on_finished(won: bool) -> void:
	_end_title.text = "ПОБЕДА" if won else "ПОРАЖЕНИЕ"
	_end_title.add_theme_color_override("font_color", BLUE if won else RED)
	var held := mode.duration - mode.time_left
	var held_text := "%d:%02d" % [int(held) / 60, int(held) % 60]
	var lines := [
		"Точка удержана — время вышло" if won else "Враги захватили точку на %s" % held_text,
		"",
		"Продержались: %s из %d:00" % [held_text, roundi(mode.duration / 60.0)],
		"Уничтожено врагов: %d, из них вами: %d" % [mode.enemies_killed, mode.player_kills],
		"Погибло союзников: %d, пришло на помощь: %d" % [mode.allies_lost, mode.allies_arrived],
	]
	_end_stats.text = "\n".join(PackedStringArray(lines))
	_end.visible = true
	get_tree().paused = true
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE


# --- построение ---------------------------------------------------------


func _build_vignette() -> void:
	var edge := Gradient.new()
	edge.offsets = PackedFloat32Array([0.0, 0.55, 1.0])
	edge.colors = PackedColorArray(
		[Color(0.6, 0, 0, 0), Color(0.6, 0, 0, 0.1), Color(0.55, 0, 0, 0.85)]
	)
	var texture := GradientTexture2D.new()
	texture.gradient = edge
	texture.fill = GradientTexture2D.FILL_RADIAL
	texture.fill_from = Vector2(0.5, 0.5)
	texture.fill_to = Vector2(1.05, 0.5)
	_vignette = TextureRect.new()
	_vignette.texture = texture
	_vignette.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	_vignette.stretch_mode = TextureRect.STRETCH_SCALE
	_vignette.set_anchors_preset(Control.PRESET_FULL_RECT)
	_vignette.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_vignette.modulate.a = 0.0
	add_child(_vignette)


func _build_panel() -> void:
	var panel := PanelContainer.new()
	panel.add_theme_stylebox_override("panel", _style(Color(1, 1, 1, 0.12)))
	_place(panel, Control.PRESET_CENTER_TOP, Rect2(-200, 8, 400, 112))
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 3)
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	panel.add_child(box)
	_timer = _label("3:00", 34, Color.WHITE)
	_timer.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(_timer)
	var back := ColorRect.new()
	back.color = Color(0.4, 0.66, 1.0, 0.45)
	back.custom_minimum_size = Vector2(_bar_width, 10)
	back.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	back.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(back)
	_bar = ColorRect.new()
	_bar.color = RED
	_bar.size = Vector2(0, 10)
	_bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	back.add_child(_bar)
	_status = _label("Точка наша", 16, BLUE)
	_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(_status)
	_forces = _label("", 13, Color(1, 1, 1, 0.85))
	_forces.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	box.add_child(_forces)


func _build_health() -> void:
	var box := Control.new()
	box.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_place(box, Control.PRESET_BOTTOM_LEFT, Rect2(20, -100, 260, 50))
	add_child(box)
	_health_text = _label("Здоровье 100", 16, Color.WHITE)
	_health_text.position = Vector2(0, 0)
	box.add_child(_health_text)
	var back := ColorRect.new()
	back.color = Color(0, 0, 0, 0.5)
	back.position = Vector2(0, 26)
	back.size = Vector2(244, 12)
	back.mouse_filter = Control.MOUSE_FILTER_IGNORE
	box.add_child(back)
	_health_bar = ColorRect.new()
	_health_bar.position = Vector2(2, 2)
	_health_bar.size = Vector2(240, 8)
	_health_bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
	back.add_child(_health_bar)


func _build_death() -> void:
	_death = ColorRect.new()
	(_death as ColorRect).color = Color(0, 0, 0, 0.35)
	_death.set_anchors_preset(Control.PRESET_FULL_RECT)
	_death.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_death.visible = false
	add_child(_death)
	_death_text = _label("", 34, Color.WHITE)
	_death_text.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_place(_death_text, Control.PRESET_CENTER, Rect2(-400, -60, 800, 120))
	_death.add_child(_death_text)


func _build_end() -> void:
	_end = ColorRect.new()
	(_end as ColorRect).color = Color(0, 0, 0, 0.7)
	_end.set_anchors_preset(Control.PRESET_FULL_RECT)
	_end.mouse_filter = Control.MOUSE_FILTER_STOP
	_end.visible = false
	add_child(_end)
	var column := VBoxContainer.new()
	column.add_theme_constant_override("separation", 14)
	column.set_anchors_preset(Control.PRESET_CENTER)
	column.grow_horizontal = Control.GROW_DIRECTION_BOTH
	column.grow_vertical = Control.GROW_DIRECTION_BOTH
	_end.add_child(column)
	_end_title = _label("", 64, BLUE)
	_end_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(_end_title)
	_end_stats = _label("", 19, Color.WHITE)
	_end_stats.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	column.add_child(_end_stats)
	var buttons := HBoxContainer.new()
	buttons.alignment = BoxContainer.ALIGNMENT_CENTER
	buttons.add_theme_constant_override("separation", 16)
	column.add_child(buttons)
	for entry in [["Ещё раз", func() -> void: Game.play(Game.team)], ["Главное меню", Game.menu]]:
		var button := Button.new()
		button.text = entry[0]
		button.custom_minimum_size = Vector2(240, 50)
		button.add_theme_font_size_override("font_size", 20)
		button.pressed.connect(entry[1])
		buttons.add_child(button)


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


func _style(border: Color) -> StyleBoxFlat:
	var style := StyleBoxFlat.new()
	style.bg_color = PANEL
	style.border_color = border
	style.set_border_width_all(2)
	style.set_corner_radius_all(6)
	style.set_content_margin_all(8)
	return style


func _place(control: Control, preset: Control.LayoutPreset, rect: Rect2) -> void:
	control.set_anchors_preset(preset)
	control.offset_left = rect.position.x
	control.offset_top = rect.position.y
	control.offset_right = rect.end.x
	control.offset_bottom = rect.end.y
