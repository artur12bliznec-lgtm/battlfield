extends Control
## Выбор команды перед боем: бойцы обеих сторон в 3D и кнопки.


func _ready() -> void:
	var background := ColorRect.new()
	background.color = Color(0.08, 0.09, 0.08)
	background.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(background)

	var column := VBoxContainer.new()
	column.set_anchors_preset(Control.PRESET_CENTER)
	column.grow_horizontal = Control.GROW_DIRECTION_BOTH
	column.grow_vertical = Control.GROW_DIRECTION_BOTH
	column.add_theme_constant_override("separation", 18)
	add_child(column)

	var title := Label.new()
	title.text = "Выбор команды"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 42)
	title.add_theme_color_override("font_color", Color(0.84, 0.64, 0.3))
	column.add_child(title)
	var subtitle := Label.new()
	subtitle.text = "Карта «Город» · режим «Удержание»: держите площадь у ратуши"
	subtitle.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	subtitle.add_theme_font_size_override("font_size", 17)
	subtitle.add_theme_color_override("font_color", Color(1, 1, 1, 0.75))
	column.add_child(subtitle)

	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 28)
	column.add_child(row)
	for id in Game.TEAMS:
		row.add_child(_card(id))

	var back := Button.new()
	back.text = "Назад"
	back.custom_minimum_size = Vector2(240, 42)
	back.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	back.pressed.connect(Game.menu)
	column.add_child(back)


func _card(id: String) -> Control:
	var team: Dictionary = Game.TEAMS[id]
	var panel := PanelContainer.new()
	var style := StyleBoxFlat.new()
	style.bg_color = Color(0.12, 0.13, 0.12)
	style.border_color = team.color
	style.set_border_width_all(2)
	style.set_corner_radius_all(8)
	style.set_content_margin_all(14)
	panel.add_theme_stylebox_override("panel", style)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 10)
	panel.add_child(box)

	# боец в рост с оружием, тихонько поворачивается
	var preview := Preview.new(Vector2i(400, 470))
	preview.framing = "soldier"
	add_child(preview)
	var soldier := Soldier.new()
	soldier.model = load(team.model)
	preview.show_model(soldier)
	soldier.equip(load(Arsenal.MODELS + str(team.weapon) + ".glb"))
	soldier.play("Rifle_Idle")
	var view := TextureRect.new()
	view.texture = preview.get_texture()
	view.custom_minimum_size = Vector2(400, 470)
	view.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	view.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	box.add_child(view)

	var name_label := Label.new()
	name_label.text = team.name
	name_label.add_theme_font_size_override("font_size", 30)
	name_label.add_theme_color_override("font_color", team.color)
	box.add_child(name_label)
	var about := Label.new()
	about.text = team.about
	about.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	about.custom_minimum_size = Vector2(400, 0)
	about.add_theme_font_size_override("font_size", 15)
	box.add_child(about)
	var button := Button.new()
	button.text = "Играть за %s" % team.join
	button.custom_minimum_size = Vector2(400, 50)
	button.add_theme_font_size_override("font_size", 20)
	button.pressed.connect(Game.play.bind(id))
	box.add_child(button)
	return panel


func _unhandled_input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if key and key.pressed and key.physical_keycode == KEY_ESCAPE:
		Game.menu()
