extends SceneTree
## Запекает навигационную сетку карты «Город» для ботов и сохраняет её в
## res://assets/maps/city_nav.res. Запуск после изменения карты:
##     godot --headless --path godot -s res://tools/bake_navmesh.gd
## Сетка строится по невидимым мешам столкновений (collision_*, bounds) —
## тем же, по которым ходит боец игрока. Отступ от стен 0,75 м — с запасом
## к капсуле бойца (0,35 м): углы и арки проходятся не задевая. Подъём —
## не выше 25 см: бордюры да, ящики и ступени памятника — нет.

const MAP := "res://assets/maps/city.glb"
const OUT := "res://assets/maps/city_nav.res"

var out := OUT

var _map: Node3D
var _frames := 0


func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() > 0:
		out = args[0]  # для проверки — сохранить в другой файл
	_map = load(MAP).instantiate()
	root.add_child(_map)


func _process(_delta: float) -> bool:
	_frames += 1
	if _frames == 2:
		_bake(_map)
	return false


func _bake(map: Node3D) -> void:
	var nav := NavigationMesh.new()
	nav.agent_radius = 0.75
	nav.agent_height = 1.75
	nav.agent_max_climb = 0.25
	nav.agent_max_slope = 40.0
	nav.cell_size = 0.25
	nav.cell_height = 0.25
	nav.region_min_size = 4.0
	nav.edge_max_length = 12.0
	nav.edge_max_error = 0.9
	nav.geometry_parsed_geometry_type = NavigationMesh.PARSED_GEOMETRY_STATIC_COLLIDERS
	nav.geometry_collision_mask = 1
	# зона боя ±95 м — дальше невидимые стены
	nav.filter_baking_aabb = AABB(Vector3(-97, -2, -97), Vector3(194, 30, 194))
	var source := NavigationMeshSourceGeometryData3D.new()
	var started := Time.get_ticks_msec()
	NavigationServer3D.parse_source_geometry_data(nav, source, map)
	NavigationServer3D.bake_from_source_geometry_data(nav, source)
	var polygons := nav.get_polygon_count()
	print(
		"navmesh: ",
		polygons,
		" polygons, ",
		nav.vertices.size(),
		" vertices, ",
		Time.get_ticks_msec() - started,
		" ms"
	)
	var error := ResourceSaver.save(nav, out, ResourceSaver.FLAG_COMPRESS)
	print("saved ", out, " error=", error)
	quit(0 if polygons > 0 and error == OK else 1)
