extends Node3D
## Демо-сцена: бойцы обеих сторон с оружием.
## Слева выбираются оружие и анимация. Правая кнопка мыши — вращать камеру,
## колесо — приблизить.

const MODELS := "res://assets/models/"
const WEAPONS := {
	"Автомат": "assault_rifle",
	"Винтовка": "rifle",
	"Пулемёт": "machine_gun",
	"Снайперская винтовка": "sniper_rifle",
	"Пистолет": "pistol",
}

var soldiers: Array[Soldier] = []
var camera: Camera3D
var clip_list: OptionButton
var yaw := 0.0
var pitch := -10.0
var distance := 5.5


func _ready() -> void:
	_build_world()
	for spec in [["soldier_alliance", -0.8], ["soldier_coalition", 0.8]]:
		var soldier := Soldier.new()
		soldier.model = load(MODELS + spec[0] + ".glb")
		soldier.position = Vector3(spec[1], 0, 0)
		add_child(soldier)
		soldiers.append(soldier)
	_build_ui()
	_equip("assault_rifle")
	_play("Rifle_Idle")


func _build_world() -> void:
	var sky := Sky.new()
	sky.sky_material = ProceduralSkyMaterial.new()
	var env := Environment.new()
	env.background_mode = Environment.BG_SKY
	env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	var world := WorldEnvironment.new()
	world.environment = env
	add_child(world)

	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-50, -35, 0)
	sun.shadow_enabled = true
	add_child(sun)

	var plane := PlaneMesh.new()
	plane.size = Vector2(40, 40)
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.36, 0.38, 0.32)
	var ground := MeshInstance3D.new()
	ground.mesh = plane
	ground.material_override = material
	add_child(ground)

	camera = Camera3D.new()
	camera.fov = 40
	add_child(camera)
	camera.make_current()
	_update_camera()


func _build_ui() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var panel := VBoxContainer.new()
	panel.position = Vector2(16, 16)
	layer.add_child(panel)

	var title := Label.new()
	title.text = "Battlfield — бойцы и анимации"
	panel.add_child(title)

	var weapon_list := OptionButton.new()
	for weapon_name in WEAPONS:
		weapon_list.add_item(weapon_name)
	weapon_list.item_selected.connect(func(index: int) -> void: _equip(WEAPONS.values()[index]))
	panel.add_child(weapon_list)

	clip_list = OptionButton.new()
	for clip_name in soldiers[0].animator.get_animation_list():
		clip_list.add_item(clip_name)
	clip_list.item_selected.connect(func(index: int) -> void: _play(clip_list.get_item_text(index)))
	panel.add_child(clip_list)

	var hint := Label.new()
	hint.text = "Правая кнопка мыши — вращать камеру, колесо — приблизить, Esc — меню"
	panel.add_child(hint)


func _equip(id: String) -> void:
	var scene: PackedScene = load(MODELS + id + ".glb")
	for soldier in soldiers:
		soldier.equip(scene)


func _play(clip: String) -> void:
	for soldier in soldiers:
		soldier.play(clip)
	for i in clip_list.item_count:
		if clip_list.get_item_text(i) == clip:
			clip_list.select(i)


func _unhandled_input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if key and key.pressed and key.physical_keycode == KEY_ESCAPE:
		get_tree().change_scene_to_file("res://scenes/menu.tscn")
		return
	var motion := event as InputEventMouseMotion
	if motion and motion.button_mask & MOUSE_BUTTON_MASK_RIGHT:
		yaw -= motion.relative.x * 0.3
		pitch = clampf(pitch - motion.relative.y * 0.3, -80.0, 10.0)
		_update_camera()
	var button := event as InputEventMouseButton
	if button and button.pressed:
		if button.button_index == MOUSE_BUTTON_WHEEL_UP:
			distance = maxf(1.5, distance * 0.9)
		elif button.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			distance = minf(15.0, distance * 1.1)
		_update_camera()


func _update_camera() -> void:
	var target := Vector3(0, 1.0, 0)
	var direction := Vector3.BACK.rotated(Vector3.RIGHT, deg_to_rad(pitch))
	direction = direction.rotated(Vector3.UP, deg_to_rad(yaw))
	camera.position = target + direction * distance
	camera.look_at(target)
