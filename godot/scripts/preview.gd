class_name Preview
extends SubViewport
## Маленькая отдельная 3D-сцена для меню и инвентаря: модель на прозрачном
## фоне со своим светом и камерой. Картинку берут через get_texture().

## Как ставить камеру: "weapon" — оружие сбоку, "soldier" — боец в рост.
var framing := "weapon"
## Покачивать модель, чтобы было видно объём.
var sway := true
var pivot: Node3D
var camera: Camera3D
var _time := 0.0


func _init(pixels := Vector2i(384, 216)) -> void:
	size = pixels
	transparent_bg = true
	own_world_3d = true
	msaa_3d = Viewport.MSAA_4X
	render_target_update_mode = SubViewport.UPDATE_ALWAYS


func _ready() -> void:
	var environment := Environment.new()
	environment.background_mode = Environment.BG_CLEAR_COLOR
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color(0.62, 0.64, 0.66)
	environment.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var world := WorldEnvironment.new()
	world.environment = environment
	add_child(world)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-40, -50, 0)
	sun.light_energy = 1.4
	add_child(sun)
	var rim := DirectionalLight3D.new()
	rim.rotation_degrees = Vector3(-20, 140, 0)
	rim.light_energy = 0.6
	add_child(rim)

	pivot = Node3D.new()
	add_child(pivot)
	camera = Camera3D.new()
	camera.fov = 26.0 if framing == "weapon" else 30.0
	add_child(camera)


## Поставить модель в центр и навести камеру. Возвращает саму модель.
func show_model(model: Node3D) -> Node3D:
	for child in pivot.get_children():
		child.queue_free()
	pivot.add_child(model)
	if framing == "soldier":
		camera.position = Vector3(0.7, 1.15, 3.7)
		camera.look_at(Vector3(0, 0.92, 0))
		return model
	var box := bounds(model)
	model.position = -box.get_center()
	var radius := box.size.length() * 0.5
	var distance := radius / tan(deg_to_rad(camera.fov * 0.5)) * 0.92
	# оружие смотрит стволом в +Z: камера слева (−X) — ствол направо
	camera.position = Vector3(-distance, radius * 0.25, 0)
	camera.look_at(Vector3.ZERO)
	return model


func _process(delta: float) -> void:
	if not pivot:
		return
	if not sway:
		pivot.rotation.y = lerpf(pivot.rotation.y, 0.0, minf(1.0, delta * 6.0))
		_time = 0.0
		return
	_time += delta
	var amplitude := 0.45 if framing == "weapon" else 0.6
	pivot.rotation.y = sin(_time * 0.6) * amplitude


## Габариты всех мешей модели (в координатах мира превью).
static func bounds(root: Node) -> AABB:
	var box := AABB()
	var first := true
	for node in root.find_children("*", "MeshInstance3D", true, false):
		var mesh := node as MeshInstance3D
		var aabb: AABB = mesh.global_transform * mesh.get_aabb()
		box = aabb if first else box.merge(aabb)
		first = false
	return box
