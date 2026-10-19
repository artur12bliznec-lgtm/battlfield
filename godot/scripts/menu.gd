extends Control
## Главное меню: играть (с выбором команды), осмотр карты, бойцы, выход.


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
	title.add_theme_font_size_override("font_size", 64)
	title.add_theme_color_override("font_color", Color(0.84, 0.64, 0.3))
	box.add_child(title)
	var subtitle := Label.new()
	subtitle.text = "Режим «Удержание» · карта «Город»"
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	subtitle.add_theme_font_size_override("font_size", 18)
	subtitle.add_theme_color_override("font_color", Color(1, 1, 1, 0.7))
	box.add_child(subtitle)

	var items := [
		["Играть", Game.choose_team],
		["Осмотр карты", Game.spectate],
		["Бойцы, оружие и анимации", _open_showcase],
		["Выход", get_tree().quit],
	]
	for item in items:
		var button := Button.new()
		button.text = item[0]
		button.custom_minimum_size = Vector2(420, 54 if item[0] == "Играть" else 46)
		button.add_theme_font_size_override("font_size", 24 if item[0] == "Играть" else 19)
		button.pressed.connect(item[1])
		box.add_child(button)


func _open_showcase() -> void:
	get_tree().change_scene_to_file("res://scenes/showcase.tscn")
