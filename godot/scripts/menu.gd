extends Control
## Стартовое меню: карта или бойцы с анимациями.

const SCENES := [
	["Карта «Город» — режим «Удержание»", "res://scenes/city.tscn"],
	["Бойцы, оружие и анимации", "res://scenes/showcase.tscn"],
]


func _ready() -> void:
	var background := ColorRect.new()
	background.color = Color(0.08, 0.09, 0.08)
	background.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(background)

	var box := VBoxContainer.new()
	box.set_anchors_preset(Control.PRESET_CENTER)
	box.grow_horizontal = Control.GROW_DIRECTION_BOTH
	box.grow_vertical = Control.GROW_DIRECTION_BOTH
	box.add_theme_constant_override("separation", 14)
	add_child(box)

	var title := Label.new()
	title.text = "BATTLFIELD"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 56)
	title.add_theme_color_override("font_color", Color(0.84, 0.64, 0.3))
	box.add_child(title)

	for item in SCENES:
		var button := Button.new()
		button.text = item[0]
		button.custom_minimum_size = Vector2(420, 52)
		button.add_theme_font_size_override("font_size", 20)
		var path: String = item[1]
		button.pressed.connect(func() -> void: get_tree().change_scene_to_file(path))
		box.add_child(button)

	var quit := Button.new()
	quit.text = "Выход"
	quit.custom_minimum_size = Vector2(420, 44)
	quit.pressed.connect(func() -> void: get_tree().quit())
	box.add_child(quit)
