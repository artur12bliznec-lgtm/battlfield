extends Node3D
## Карта «Город» для режима «Удержание»: точка захвата на площади, защитники
## появляются во дворе ратуши, волны врагов — с четырёх сторон.
##
## Игровой логики пока нет — только карта, отметки режима и наблюдатель.
## Отметки лежат в узле Mode: CapturePoint (Area3D), DefenderSpawns,
## AttackerSpawns/North|East|South|West (Marker3D). Z — показать или скрыть
## их в игре, Esc — в меню.

const HINT := (
	"ПКМ — смотреть · WASD — двигаться · Q/E — вниз/вверх · Shift — быстрее\n"
	+ "F — пешком/полёт · Z — отметки режима · Esc — меню"
)

@onready var markers: Node3D = $Mode/Debug


func _ready() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var label := Label.new()
	label.text = "Город · режим «Удержание»\n" + HINT
	label.position = Vector2(16, 12)
	label.add_theme_color_override("font_color", Color(1, 1, 1))
	label.add_theme_color_override("font_outline_color", Color(0, 0, 0))
	label.add_theme_constant_override("outline_size", 6)
	layer.add_child(label)


func _unhandled_input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if not key or not key.pressed or key.echo:
		return
	if key.physical_keycode == KEY_Z:
		markers.visible = not markers.visible
	elif key.physical_keycode == KEY_ESCAPE:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
		get_tree().change_scene_to_file("res://scenes/menu.tscn")
