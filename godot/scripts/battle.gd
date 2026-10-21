class_name Battle
extends Node3D
## Атмосфера боя на карте «Город».
##
## Пожары, тление и столбы дыма — у отметок fx_* из карты (их расставляет
## генератор карты у подбитой техники и горящих домов), ещё столбы дыма — на
## горизонте. Вдали и рядом рвутся снаряды, слышна стрельба, в небе — трассеры
## и осветительные ракеты. Звук: гул боя, треск огня, сирена.
##
## При осмотре карты (decor) враги ещё и бьют очередями по позициям
## защитников, а нарисованные союзники за баррикадами отстреливаются — это
## декорации, никого не ранят. В режиме «Удержание» воюют настоящие бойцы
## (hold_mode.gd), а снаряды на подступах ранят всех рядом (сигнал blast).

signal blast(at: Vector3)

const SPEED_OF_SOUND := 343.0
## Откуда идут волны врагов: дальний конец улицы → позиции защитников.
const FRONTS := [
	[Vector3(0, 1.4, 92), Vector3(0, 1.0, 27)],
	[Vector3(92, 1.4, 0), Vector3(31, 1.0, 0)],
	[Vector3(-92, 1.4, 0), Vector3(-31, 1.0, 0)],
	[Vector3(-27, 1.4, -92), Vector3(-22, 1.0, -24)],
	[Vector3(27, 1.4, -92), Vector3(22, 1.0, -24)],
]
## Куда ложатся снаряды рядом: улицы на подступах к площади.
const NEAR_ZONES := [
	[Vector3(-4, 0, 40), Vector3(4, 0, 88)],
	[Vector3(40, 0, -3), Vector3(88, 0, 3)],
	[Vector3(-88, 0, -3), Vector3(-40, 0, 3)],
	[Vector3(-29, 0, -88), Vector3(-25, 0, -40)],
	[Vector3(25, 0, -88), Vector3(29, 0, -40)],
]
## Столбы дыма на горизонте: [угол, расстояние, размер].
const FAR_COLUMNS := [
	[0.4, 150, 4.2],
	[1.3, 175, 3.6],
	[2.2, 140, 4.6],
	[3.1, 185, 3.8],
	[3.9, 160, 4.0],
	[4.8, 170, 4.4],
	[5.6, 145, 3.4]
]
const TRACER_ENEMY := Color(0.35, 1.0, 0.4)
const TRACER_ALLY := Color(1.0, 0.5, 0.2)

## Карта (корень сцены city.glb) — там отметки fx_*.
var map: Node3D
## Узел Mode: позиции союзников AllyPosts.
var mode: Node3D
## Команда игрока: союзники — в её форме.
var team := "alliance"
## Декорации боя: союзники за баррикадами и обстрел их позиций.
var decor := true

var _time := 0.0
var _next := {}
var _trauma := 0.0
var _shaking := false
var _ash: GPUParticles3D


func _ready() -> void:
	_spawn_map_fx()
	_spawn_far_columns()
	if decor:
		_spawn_allies()
	_ash = BattleFx.ash()
	add_child(_ash)
	# по частицам осколков — столкновения с землёй вокруг камеры
	var ground := GPUParticlesCollisionHeightField3D.new()
	ground.size = Vector3(160, 60, 160)
	ground.follow_camera_enabled = true
	ground.update_mode = GPUParticlesCollisionHeightField3D.UPDATE_MODE_WHEN_MOVED
	add_child(ground)

	var ambience := AudioStreamPlayer.new()
	ambience.stream = Sfx.stream("ambience_loop")
	ambience.volume_db = -7.0
	add_child(ambience)
	ambience.play(randf() * 20.0)

	_schedule("far_blast", 2.0, 4.0)
	_schedule("near_blast", 18.0, 30.0)
	_schedule("far_fire", 1.0, 3.0)
	if decor:
		_schedule("incoming", 5.0, 9.0)
	_schedule("sky", 6.0, 12.0)
	_schedule("flare", 30.0, 60.0)
	_schedule("siren", 20.0, 40.0)


func _process(delta: float) -> void:
	_time += delta
	for event: String in _next.keys():
		if _time >= _next[event]:
			call("_on_" + event)
	var camera := get_viewport().get_camera_3d()
	if camera:
		_ash.global_position = camera.global_position
		_shake(camera, delta)


## Встряхнуть камеру (0..1) — от близкого разрыва.
func shake(amount: float) -> void:
	_trauma = minf(1.0, _trauma + amount)


func _shake(camera: Camera3D, delta: float) -> void:
	_trauma = maxf(0.0, _trauma - delta * 0.8)
	if _trauma > 0.0:
		var t := _trauma * _trauma
		camera.h_offset = randf_range(-1, 1) * t * 0.22
		camera.v_offset = randf_range(-1, 1) * t * 0.22
		_shaking = true
	elif _shaking:
		camera.h_offset = 0.0
		camera.v_offset = 0.0
		_shaking = false


func _schedule(event: String, low: float, high: float) -> void:
	_next[event] = _time + randf_range(low, high)


func _listener() -> Vector3:
	var camera := get_viewport().get_camera_3d()
	return camera.global_position if camera else Vector3.ZERO


## Звук издалека: приходит с опозданием — свет быстрее звука.
func _sound_from(sound: String, at: Vector3, volume_db: float, unit_size: float) -> void:
	var delay := at.distance_to(_listener()) / SPEED_OF_SOUND
	if delay < 0.05:
		Sfx.play_at(self, sound, at, volume_db, unit_size)
		return
	get_tree().create_timer(delay, false).timeout.connect(
		func() -> void: Sfx.play_at(self, sound, at, volume_db, unit_size)
	)


# --- эффекты на карте ---------------------------------------------------


func _spawn_map_fx() -> void:
	if not map:
		return
	for marker: Node3D in map.find_children("fx_*", "Node3D", true, false):
		var kind := marker.name.split("_")[1]
		var size := marker.scale.x
		var effect: Node3D
		match kind:
			"fire":
				effect = BattleFx.fire(size)
			"smoke":
				effect = BattleFx.smolder(size)
			"column":
				effect = BattleFx.fire(size * 0.8)
				var column := BattleFx.smoke_column(size * 1.4)
				column.position.y = 1.5
				effect.add_child(column)
			_:
				continue
		add_child(effect)
		effect.global_position = marker.global_position
		if kind != "smoke":
			var crackle := AudioStreamPlayer3D.new()
			crackle.stream = Sfx.stream("fire_loop")
			crackle.unit_size = 3.0 * size
			crackle.volume_db = -3.0
			crackle.max_distance = 45.0
			effect.add_child(crackle)
			crackle.play(randf() * 5.0)


func _spawn_far_columns() -> void:
	for spec: Array in FAR_COLUMNS:
		var column := BattleFx.smoke_column(spec[2])
		add_child(column)
		column.global_position = Vector3(cos(spec[0]) * spec[1], 0, sin(spec[0]) * spec[1])
		var glow := BattleFx.Flicker.new()
		glow.base_energy = 6.0
		glow.light_color = Color(1.0, 0.5, 0.2)
		glow.omni_range = 30.0
		add_child(glow)
		glow.global_position = column.global_position + Vector3(0, 6, 0)


# --- события боя --------------------------------------------------------


## Разрыв вдали, за городом: вспышка, дым над крышами, глухой удар с опозданием.
func _on_far_blast() -> void:
	_schedule("far_blast", 3.0, 9.0)
	var a := randf() * TAU
	var at := Vector3(cos(a), 0, sin(a)) * randf_range(130.0, 340.0)
	BattleFx.explosion(self, at, randf_range(1.6, 2.6))
	_sound_from("explosion_far_%d" % randi_range(1, 2), at, randf_range(4.0, 9.0), 60.0)
	var d := at.distance_to(_listener())
	shake(clampf(0.5 - d / 500.0, 0.0, 0.25))


## Снаряд на подступах к площади: свист, разрыв, тряска, если близко.
func _on_near_blast() -> void:
	_schedule("near_blast", 22.0, 45.0)
	var at := Vector3.ZERO
	for attempt in 8:
		var zone: Array = NEAR_ZONES[randi() % NEAR_ZONES.size()]
		at = Vector3(randf_range(zone[0].x, zone[1].x), 0, randf_range(zone[0].z, zone[1].z))
		if at.distance_to(_listener()) > 28.0:
			break
	Sfx.play_at(self, "shell_whistle", at + Vector3(0, 25, 0), 2.0, 30.0)
	get_tree().create_timer(1.65, false).timeout.connect(_near_blast_hit.bind(at))


func _near_blast_hit(at: Vector3) -> void:
	BattleFx.explosion(self, at, 1.2)
	blast.emit(at)
	_sound_from("explosion_near_%d" % randi_range(1, 2), at, 6.0, 25.0)
	var d := at.distance_to(_listener())
	shake(clampf(1.2 - d / 60.0, 0.0, 0.9))


## Перестрелка вдали: очереди за домами.
func _on_far_fire() -> void:
	_schedule("far_fire", 2.0, 6.0)
	var a := randf() * TAU
	var at := Vector3(cos(a), 2, sin(a)) * randf_range(110.0, 260.0)
	_sound_from("gunfire_far_%d" % randi_range(1, 3), at, randf_range(-2.0, 4.0), 40.0)


## Трассеры в небе: дальняя очередь уходит вверх над крышами.
func _on_sky() -> void:
	_schedule("sky", 4.0, 11.0)
	var a := randf() * TAU
	var from := Vector3(cos(a), 6, sin(a)) * randf_range(120.0, 220.0)
	var dir := (Vector3(randf_range(-1, 1), randf_range(0.6, 1.4), randf_range(-1, 1))).normalized()
	var color := TRACER_ENEMY if randf() < 0.5 else TRACER_ALLY
	for k in randi_range(5, 12):
		var to := (
			from
			+ dir * 260.0
			+ Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * 6.0
		)
		get_tree().create_timer(k * 0.09, false).timeout.connect(
			func() -> void: BattleFx.tracer(self, from, to, color, 300.0)
		)


## Враги бьют очередью с дальнего конца улицы по позициям защитников.
func _on_incoming() -> void:
	_schedule("incoming", 3.0, 8.0)
	var front: Array = FRONTS[randi() % FRONTS.size()]
	var from: Vector3 = (
		front[0] + Vector3(randf_range(-3, 3), randf_range(0, 2), randf_range(-3, 3))
	)
	var aim: Vector3 = front[1]
	var space := get_world_3d().direct_space_state
	var shots := randi_range(3, 8)
	for k in shots:
		var target := aim + Vector3(randf_range(-6, 6), randf_range(0.3, 5.0), randf_range(-6, 6))
		var to := from + (target - from).normalized() * 160.0
		var query := PhysicsRayQueryParameters3D.create(from, to)
		var hit := space.intersect_ray(query)
		var end: Vector3 = hit.position if hit else to
		var delay := k * 0.11
		if k % 2 == 0:
			get_tree().create_timer(delay, false).timeout.connect(
				func() -> void: BattleFx.tracer(self, from, end, TRACER_ENEMY, 380.0)
			)
		if hit:
			var t := delay + from.distance_to(end) / 380.0
			get_tree().create_timer(t, false).timeout.connect(_impact.bind(end, hit.normal))
		_flyby(from, end, delay)


## Пуля пролетела рядом с камерой — сухой треск.
func _flyby(from: Vector3, to: Vector3, delay: float) -> void:
	var ear := _listener()
	var line := to - from
	var t := clampf((ear - from).dot(line) / line.length_squared(), 0.0, 1.0)
	var closest := from + line * t
	if closest.distance_to(ear) < 5.0 and t < 0.995:
		var when := delay + from.distance_to(closest) / 380.0
		get_tree().create_timer(when, false).timeout.connect(
			func() -> void: Sfx.play_at(self, "bullet_crack", closest, 2.0, 6.0)
		)


func _impact(at: Vector3, normal: Vector3) -> void:
	Effects.impact(self, at, normal)
	var sound := (
		"ricochet_%d" % randi_range(1, 2) if randf() < 0.2 else "impact_%d" % randi_range(1, 2)
	)
	Sfx.play_at(self, sound, at, -2.0, 6.0)


## Осветительная ракета над полем боя.
func _on_flare() -> void:
	_schedule("flare", 50.0, 110.0)
	var a := randf() * TAU
	BattleFx.flare(self, Vector3(cos(a), 0, sin(a)) * randf_range(40.0, 90.0) + Vector3(0, 55, 0))


## Воздушная тревога где-то в городе.
func _on_siren() -> void:
	_schedule("siren", 160.0, 260.0)
	var a := randf() * TAU
	Sfx.play_at(self, "siren", Vector3(cos(a), 20, sin(a)) * 180.0, 6.0, 120.0)


# --- союзники -----------------------------------------------------------


func _spawn_allies() -> void:
	var posts: Node = mode.get_node_or_null("AllyPosts") if mode else null
	if not posts:
		return
	var weapon: String = Game.TEAMS[team].weapon
	var index := 0
	for post: Node3D in posts.get_children():
		var ally := Ally.new()
		ally.battle = self
		ally.model = load(Game.TEAMS[team].model)
		ally.weapon = Arsenal.ITEMS[2] if index == 2 else _item(weapon)
		add_child(ally)
		ally.global_transform = post.global_transform
		index += 1


func _item(id: String) -> Dictionary:
	for item: Dictionary in Arsenal.ITEMS:
		if item.id == id:
			return item
	return Arsenal.ITEMS[0]


## Куда стреляет союзник: вниз по улице перед собой, с разбросом.
func ally_target(from: Vector3, forward: Vector3) -> Vector3:
	var side := forward.cross(Vector3.UP).normalized()
	var far := randf_range(50.0, 110.0)
	return (
		from + forward * far + side * randf_range(-7.0, 7.0) + Vector3(0, randf_range(-0.5, 5.0), 0)
	)


## Выстрел союзника: звук, трассер, пыль там, куда попала пуля.
func ally_shot(muzzle: Vector3, target: Vector3, tracer: bool) -> void:
	var query := PhysicsRayQueryParameters3D.create(muzzle, target)
	var hit := get_world_3d().direct_space_state.intersect_ray(query)
	var end: Vector3 = hit.position if hit else target
	if tracer:
		BattleFx.tracer(self, muzzle, end, TRACER_ALLY, 420.0)
	if hit and randf() < 0.4:
		var normal: Vector3 = hit.normal
		get_tree().create_timer(muzzle.distance_to(end) / 420.0, false).timeout.connect(
			func() -> void: Effects.impact(self, end, normal)
		)


## Боец за баррикадой: прячется, поднимается и бьёт очередью вдоль улицы.
class Ally:
	extends Node3D
	var battle: Battle
	var model: PackedScene
	var weapon: Dictionary
	var soldier: Soldier
	var _flash: Node3D
	var _audio: AudioStreamPlayer3D
	var _state := "cover"
	var _until := 0.0
	var _time := 0.0
	var _next_shot := 0.0
	var _flash_until := 0.0
	var _shots := 0

	func _ready() -> void:
		soldier = Soldier.new()
		soldier.model = model
		soldier.rotation.y = PI  # модель смотрит на +Z, а «вперёд» у узла — −Z
		add_child(soldier)
		soldier.equip(Arsenal.scene(weapon))
		var muzzle := soldier.weapon.find_child("muzzle", true, false) as Node3D
		_flash = Effects.make_flash()
		if muzzle:
			muzzle.add_child(_flash)
		else:
			soldier.weapon.add_child(_flash)
		_audio = Sfx.gun(self)
		_audio.volume_db = -3.0
		_enter("cover", randf_range(0.5, 4.0))

	func _enter(state: String, duration: float) -> void:
		_state = state
		_until = _time + duration
		match state:
			"cover":
				soldier.play("Rifle_Crouch_Idle", 0.3)
			"rise":
				soldier.play("Rifle_Aim", 0.25)
			"fire":
				soldier.play("Rifle_Fire", 0.1)
				_shots = randi_range(4, 9) if weapon.auto else randi_range(2, 3)
				if weapon.id == "machine_gun":
					_shots = randi_range(8, 16)
				_next_shot = _time

	func _process(delta: float) -> void:
		_time += delta
		if _flash.visible and _time > _flash_until:
			_flash.visible = false
		match _state:
			"cover":
				if _time >= _until:
					_enter("rise", 0.35)
			"rise":
				if _time >= _until:
					_enter("fire", 99.0)
			"fire":
				if _shots <= 0:
					_enter("cover", randf_range(2.0, 6.5))
				elif _time >= _next_shot:
					_shoot()

	func _shoot() -> void:
		_shots -= 1
		var rate := 60.0 / float(weapon.rpm)
		if not weapon.auto:
			rate = randf_range(0.35, 0.7)
		_next_shot = _time + rate
		_flash.visible = true
		_flash_until = _time + 0.05
		Sfx.shoot(_audio, "shot_" + str(weapon.id), randf_range(0.95, 1.05))
		var muzzle := _flash.global_position
		var forward := -global_transform.basis.z
		var target := battle.ally_target(muzzle, forward)
		battle.ally_shot(muzzle, target, _shots % 3 == 0)
