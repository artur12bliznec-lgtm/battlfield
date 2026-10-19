extends Node3D
## Карта «Город» для режима «Удержание»: точка захвата на площади, защитники
## появляются во дворе ратуши, волны врагов — с четырёх сторон.
##
## Если игра запущена через «Играть» (Game.playing), на месте появления
## защитников встаёт боец игрока с интерфейсом боя. Иначе — наблюдатель
## для осмотра карты. Отметки режима лежат в узле Mode: CapturePoint
## (Area3D), DefenderSpawns, AttackerSpawns/North|East|South|West (Marker3D).

const HINT := (
	"ПКМ — смотреть · WASD — двигаться · Q/E — вниз/вверх · Shift — быстрее\n"
	+ "F — пешком/полёт · M — отметки режима · Esc — меню"
)

var player: Player

@onready var markers: Node3D = $Mode/Debug


func _ready() -> void:
	if Game.playing:
		_start_game()
	else:
		_start_spectator()


func _start_game() -> void:
	$Spectator.queue_free()
	markers.visible = false
	var spawns := $Mode/DefenderSpawns.get_children()
	var spawn := spawns[randi() % spawns.size()] as Node3D
	player = Player.new()
	player.team = Game.team
	player.transform = spawn.global_transform
	add_child(player)
	var hud := Hud.new()
	hud.player = player
	add_child(hud)
	var zone := $Mode/CapturePoint as Area3D
	zone.body_entered.connect(_on_zone.bind(true))
	zone.body_exited.connect(_on_zone.bind(false))


func _start_spectator() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var label := Label.new()
	label.text = "Город · осмотр карты\n" + HINT
	label.position = Vector2(16, 12)
	label.add_theme_color_override("font_color", Color(1, 1, 1))
	label.add_theme_color_override("font_outline_color", Color(0, 0, 0))
	label.add_theme_constant_override("outline_size", 6)
	layer.add_child(label)


func _on_zone(body: Node3D, inside: bool) -> void:
	if body == player:
		player.on_point = inside


func _unhandled_input(event: InputEvent) -> void:
	if Game.playing:
		return
	var key := event as InputEventKey
	if not key or not key.pressed or key.echo:
		return
	if key.physical_keycode == KEY_M:
		markers.visible = not markers.visible
	elif key.physical_keycode == KEY_ESCAPE:
		Game.menu()
