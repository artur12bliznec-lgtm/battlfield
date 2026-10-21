extends Node3D
## Карта «Город» для режима «Удержание»: точка захвата на площади, защитники
## появляются во дворе ратуши, волны врагов — с четырёх сторон.
##
## Если игра запущена через «Играть» (Game.playing), идёт режим «Удержание»
## (hold_mode.gd): боец игрока встаёт во дворе ратуши, союзники-боты приходят
## на подмогу, враги-боты идут волнами; ходят они по навигационной сетке
## city_nav.res (её печёт tools/bake_navmesh.gd). Иначе — наблюдатель для
## осмотра карты. В обоих случаях вокруг идёт бой (battle.gd): пожары, дым,
## разрывы, стрельба. Отметки режима лежат в узле Mode: CapturePoint (Area3D),
## DefenderSpawns, AttackerSpawns/North|East|South|West, AllyPosts и
## DefensePosts (Marker3D).

const HINT := (
	"ПКМ — смотреть · WASD — двигаться · Q/E — вниз/вверх · Shift — быстрее\n"
	+ "F — пешком/полёт · M — отметки режима · Esc — меню"
)

const NAVMESH := "res://assets/maps/city_nav.res"

var player: Player
var battle: Battle
var mode: HoldMode

@onready var markers: Node3D = $Mode/Debug


func _ready() -> void:
	battle = Battle.new()
	battle.map = $Map
	battle.mode = $Mode
	battle.team = Game.team
	battle.decor = not Game.playing
	add_child(battle)
	if Game.playing:
		_start_game()
	else:
		_start_spectator()


func _start_game() -> void:
	$Spectator.queue_free()
	markers.visible = false
	var navigation := NavigationRegion3D.new()
	navigation.navigation_mesh = load(NAVMESH)
	add_child(navigation)

	var spawns: Array[Node3D] = []
	for spawn: Node3D in $Mode/DefenderSpawns.get_children():
		spawns.append(spawn)
	player = Player.new()
	player.team = Game.team
	player.spawns = spawns
	player.transform = spawns.pick_random().global_transform
	add_child(player)

	mode = HoldMode.new()
	mode.duration = Game.duration
	mode.team = Game.team
	for id: String in Game.TEAMS:
		if id != Game.team:
			mode.enemy_team = id
	mode.player = player
	mode.world = self
	mode.marks = $Mode
	add_child(mode)
	battle.blast.connect(mode.blast)

	var hud := Hud.new()
	hud.player = player
	hud.mode = mode
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
