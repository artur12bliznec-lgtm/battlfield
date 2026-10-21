class_name Bot
extends CharacterBody3D
## Боец под управлением компьютера: союзник или враг.
##
## Идёт по навигационной сетке к цели (союзник — на позицию у точки, враг —
## на саму точку), бежит, пока далеко и никого не видит. Раз в ~0,3 с
## осматривается: ближайший противник в прямой видимости становится целью.
## Тогда боец останавливается, разворачивается и бьёт очередями — чем дольше
## целится, тем точнее. Магазин кончается — перезарядка.
##
## Пока не дошёл до цели, воюет перебежками: постреляет несколько секунд —
## и снова бежит, а на бегу отвлекается только на тех, кто совсем рядом.
## На месте держит позицию и стреляет, пока есть по кому. Убит — падает и
## через время исчезает.

signal died(bot: Bot, killer: Node)

const GRAVITY := 18.0
const MAX_HEALTH := 100.0
const RUN := 4.5
const JOG := 2.65
## Насколько хуже игрока стреляют боты (множитель разброса оружия).
const ENEMY_SKILL := 2.4
const ALLY_SKILL := 1.8
const EYE := 1.55
## Бордюр или ступенька, на которую боец поднимается «с ходу».
const STEP := 0.4
## На перебежке останавливается стрелять, только если противник ближе.
const CLOSE := 18.0
## Дальше от камеры выстрелы не озвучиваются: их и так почти не слышно.
const HEAR := 110.0

## Команда: ключ из Game.TEAMS.
var team := "coalition"
## Враг игрока (иначе — союзник).
var hostile := true
## Роль: rifle, mg, sniper.
var role := "rifle"
var weapon: Dictionary
var health := MAX_HEALTH
var alive := true
var crouched := false
## Куда идти и куда смотреть, дойдя.
var goal := Vector3.ZERO
var goal_facing := Vector3.FORWARD
## Режим: кто свои, кто чужие.
var mode: Node
var soldier: Soldier
var kills := 0

var _agent: NavigationAgent3D
var _target: Node3D
var _state := "move"
var _time := 0.0
var _next_look := 0.0
var _seen_at := 0.0
var _engage_until := 0.0
## До какого времени длится перебежка (дальние цели не останавливают).
var _advance_until := 0.0
var _next_shot := 0.0
var _burst := 0
var _ammo := 30
var _reload_until := 0.0
var _flash: Node3D
var _flash_until := 0.0
var _clip := ""
var _shots := 0
var _stuck_check := 0.0
var _stuck_from := Vector3.ZERO
var _stuck_count := 0
## Путь по навигационной сетке и следующая его точка.
var _path := PackedVector3Array()
var _path_i := 0
var _next_repath := 0.0
var _arrived := false


func _ready() -> void:
	# слой 2 — бойцы (в них попадают пули), сталкиваемся только с миром (1):
	# иначе, появившись в одной точке, бойцы выталкивают друг друга вверх и
	# «взбираются» друг на друга; расходиться помогает агент навигации
	collision_layer = 2
	collision_mask = 1
	floor_max_angle = deg_to_rad(50.0)
	floor_snap_length = 0.4
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.35
	capsule.height = 1.8
	var shape := CollisionShape3D.new()
	shape.shape = capsule
	shape.position.y = 0.9
	add_child(shape)

	soldier = Soldier.new()
	soldier.model = load(Game.TEAMS[team].model)
	soldier.rotation.y = PI  # модель смотрит на +Z, а «вперёд» у бойца — −Z
	add_child(soldier)
	soldier.equip(Arsenal.scene(weapon))
	var muzzle := soldier.weapon.find_child("muzzle", true, false) as Node3D
	_flash = Effects.make_flash()
	(muzzle if muzzle else soldier.weapon).add_child(_flash)
	_ammo = weapon.capacity

	# агент — только чтобы расходиться с соседями; путь строим сами (_repath)
	_agent = NavigationAgent3D.new()
	_agent.radius = 0.45
	_agent.height = 1.8
	_agent.max_speed = RUN + 0.5
	_agent.avoidance_enabled = true
	_agent.neighbor_distance = 6.0
	_agent.max_neighbors = 6
	_agent.time_horizon_agents = 0.8
	add_child(_agent)
	_agent.velocity_computed.connect(_on_velocity)
	_time = randf() * 0.3
	_next_look = _time + randf() * 0.3
	go(goal, goal_facing)


## Идти к точке at и встать лицом к facing.
func go(at: Vector3, facing := Vector3.FORWARD) -> void:
	goal = at
	goal_facing = facing
	_path = PackedVector3Array()  # новый путь построится на ходу
	_arrived = false
	if _agent:
		_agent.target_position = at
	if alive and _state != "engage":
		_state = "move"
	elif _state == "engage":
		_engage_until = minf(_engage_until, _time + 1.5)  # доотстреляться — и в путь


## Куда целиться в этого бойца — в грудь.
func aim_point() -> Vector3:
	return global_position + Vector3(0, 0.95 if crouched else 1.35, 0)


func take_damage(amount: float, from: Node, _at := Vector3.INF) -> void:
	if not alive:
		return
	if from and from.get("team") == team:
		return  # по своим не попадает
	health -= amount
	if health <= 0.0:
		_die(from)
		return
	# обстреляли — развернуться к стрелку (на перебежке — не всегда)
	if _advancing() and randf() < 0.6:
		return
	if from is Node3D and (not _target or not _visible_target()):
		if from.get("alive"):
			_target = from
			_seen_at = _time - 0.3
			_state = "engage"
			_engage_until = _time + randf_range(2.0, 4.0)


func _physics_process(delta: float) -> void:
	_time += delta
	if not is_on_floor():
		velocity.y -= GRAVITY * delta
	if not alive:
		velocity.x = 0.0
		velocity.z = 0.0
		move_and_slide()
		return
	if _flash.visible and _time > _flash_until:
		_flash.visible = false
	if _time >= _next_look:
		_next_look = _time + randf_range(0.25, 0.4)
		_look_around()
	match _state:
		"move":
			_move(delta)
		"engage":
			_engage(delta)
		"hold":
			_hold(delta)
	_check_stuck()


# --- восприятие ----------------------------------------------------------


func _range() -> float:
	if _advancing():
		return CLOSE
	match role:
		"sniper":
			return 110.0
		"mg":
			return 55.0
	return 45.0


func _advancing() -> bool:
	return _state == "move" and _time < _advance_until


func _look_around() -> void:
	if _target and (not _target.get("alive") or not _visible_target()):
		_target = null
	if _target and _advancing():
		_target = null  # на перебежке старую цель не держим
	var best: Node3D
	var best_d := _range()
	var eye := global_position + Vector3(0, EYE, 0)
	var checks := 0
	for other: Node3D in mode.opponents_of(self):
		var d := eye.distance_to(other.aim_point())
		if d >= best_d or checks >= 4:
			continue
		checks += 1
		if _line_clear(eye, other.aim_point()):
			best = other
			best_d = d
	if best and best != _target:
		# новая цель — время на реакцию
		var keep := _target and eye.distance_to(_target.aim_point()) < best_d + 5.0
		if not keep:
			_target = best
			_seen_at = _time + randf_range(0.35, 0.8)
	if _target and _state != "engage":
		_state = "engage"
		_engage_until = _time + (999.0 if _at_goal() else randf_range(2.5, 5.0))


func _visible_target() -> bool:
	return _line_clear(global_position + Vector3(0, EYE, 0), _target.aim_point())


func _line_clear(from: Vector3, to: Vector3) -> bool:
	var query := PhysicsRayQueryParameters3D.create(from, to, 1)
	return get_world_3d().direct_space_state.intersect_ray(query).is_empty()


# --- движение ------------------------------------------------------------


func _at_goal() -> bool:
	return _arrived or _flat_to(goal) < 1.6


func _flat_to(at: Vector3) -> float:
	return Vector2(at.x - global_position.x, at.z - global_position.z).length()


## Путь до цели по навигационной сетке; jitter — сдвинуть цель, если застрял.
func _repath(jitter := 0.0) -> void:
	_next_repath = _time + 0.5
	var to := goal + Vector3(randf_range(-jitter, jitter), 0, randf_range(-jitter, jitter))
	var map := get_world_3d().navigation_map
	_path = NavigationServer3D.map_get_path(map, global_position, to, true)
	_path_i = 0


func _move(delta: float) -> void:
	crouched = false
	if _path.is_empty() and _time >= _next_repath:
		_repath()
	# точки пути — точно по углам, без срезания (иначе цепляет углы арок);
	# расстояние по плоскости: сетка лежит чуть выше земли
	while _path_i < _path.size() and _flat_to(_path[_path_i]) < 0.45:
		_path_i += 1
	if not _path.is_empty() and _path_i >= _path.size():
		_arrived = true
	if _at_goal():
		_state = "hold"
		_stop()
		return
	if _path.is_empty():
		_stop()  # сетка ещё не собрана — подождать
		_play("Rifle_Idle")
		return
	var next := _path[_path_i]
	var dir := Vector3(next.x - global_position.x, 0, next.z - global_position.z).normalized()
	var far := global_position.distance_to(goal) > 14.0
	var speed := RUN if far else JOG
	_agent.velocity = dir * speed
	_face(dir, delta, 8.0)
	_play("Rifle_Sprint" if speed > 3.5 else "Rifle_Jog_Forward")


func _on_velocity(safe: Vector3) -> void:
	if not alive:
		return
	velocity.x = safe.x
	velocity.z = safe.z
	move_and_slide()
	var flat := Vector3(safe.x, 0, safe.z)
	if is_on_floor() and is_on_wall() and flat.length() > 0.1:
		_step_up(flat * get_physics_process_delta_time())


## Подняться на бордюр или ступеньку, если упёрлись в неё (как игрок).
func _step_up(motion: Vector3) -> void:
	var start := global_position
	var lift := Vector3(0, STEP, 0)
	if test_move(global_transform, lift):
		return
	global_position += lift
	if test_move(global_transform, motion):
		global_position = start
		return
	global_position += motion
	var ground := move_and_collide(-lift)
	if not ground or ground.get_normal().y < 0.7:
		global_position = start


func _stop() -> void:
	_agent.velocity = Vector3.ZERO


func _face(dir: Vector3, delta: float, speed: float) -> void:
	if Vector2(dir.x, dir.z).length() < 0.01:
		return
	var yaw := atan2(-dir.x, -dir.z)
	rotation.y = lerp_angle(rotation.y, yaw, minf(1.0, delta * speed))


## Застрял (уткнулся и не двигается) — перестроить путь от того места, где
## стоит; застрял снова — к цели чуть в стороне.
func _check_stuck() -> void:
	if _time < _stuck_check:
		return
	_stuck_check = _time + 1.5
	if _state == "move" and global_position.distance_to(_stuck_from) < 0.4:
		_stuck_count += 1
		_repath(minf(_stuck_count - 1, 4.0))
	else:
		_stuck_count = 0
	_stuck_from = global_position


# --- бой ------------------------------------------------------------------


func _hold(delta: float) -> void:
	_stop()
	crouched = true
	_face(goal_facing, delta, 4.0)
	if _reloading():
		_play("Rifle_Reload")
		return
	_play("Rifle_Crouch_Idle")


func _engage(delta: float) -> void:
	_stop()
	if not _target or not _target.get("alive"):
		_target = null
		_state = "hold" if _at_goal() else "move"
		return
	var to: Vector3 = _target.aim_point() - global_position
	_face(to, delta, 10.0)
	# у цели и на месте — присесть, в поле — через раз
	crouched = _at_goal() or (int(get_instance_id()) % 2 == 0)
	if _reloading():
		_play("Rifle_Reload")
		return
	if _time < _seen_at:
		_play("Rifle_Crouch_Idle" if crouched else "Rifle_Aim")
		return
	if _time > _engage_until and not _at_goal():
		# хватит — перебежка дальше к цели
		_state = "move"
		_target = null
		_advance_until = _time + randf_range(3.0, 6.0)
		return
	if _time >= _next_shot:
		_shoot()
	var firing := _time < _next_shot + 0.1 and _burst > 0
	if crouched:
		_play("Rifle_Crouch_Idle")
	else:
		_play("Rifle_Fire" if firing else "Rifle_Aim")


func _reloading() -> bool:
	return _time < _reload_until


func _shoot() -> void:
	if _ammo <= 0:
		_ammo = weapon.capacity
		_reload_until = _time + (4.5 if role == "mg" else 2.3)
		_next_shot = _reload_until + 0.2
		return
	if _burst <= 0:
		# новая очередь
		match role:
			"mg":
				_burst = randi_range(6, 12)
			"sniper":
				_burst = 1
			_:
				_burst = randi_range(3, 6) if weapon.auto else randi_range(1, 2)
	_burst -= 1
	_ammo -= 1
	_shots += 1
	var rate := 60.0 / float(weapon.rpm)
	if role == "sniper":
		rate = randf_range(2.0, 3.2)
	elif not weapon.auto:
		rate = randf_range(0.35, 0.6)
	_next_shot = _time + rate + (randf_range(0.35, 1.0) if _burst <= 0 else 0.0)

	_flash.visible = true
	_flash_until = _time + 0.05
	var camera := get_viewport().get_camera_3d()
	if camera and camera.global_position.distance_to(global_position) < HEAR:
		Sfx.play_at(self, "shot_" + str(weapon.id), _flash.global_position, -2.0, 12.0)

	var muzzle := _flash.global_position
	var aim: Vector3 = _target.aim_point()
	var skill := ENEMY_SKILL if hostile else ALLY_SKILL
	if role == "sniper":
		skill = 0.5
	var settle := clampf((_time - _seen_at) / 1.5, 0.0, 1.0)
	var spread := deg_to_rad(float(weapon.spread)) * skill * (1.6 - settle * 0.8) + deg_to_rad(0.6)
	var dir := (aim - muzzle).normalized()
	var side := dir.cross(Vector3.UP).normalized()
	dir = dir.rotated(Vector3.UP, randf_range(-spread, spread))
	dir = dir.rotated(side, randf_range(-spread, spread) * 0.7)
	mode.fire(self, muzzle, dir, float(weapon.damage), _shots % 3 == 0)


## Клип бойца; Soldier сам запускает анимации оружия (затвор, магазин).
func _play(clip: String) -> void:
	if clip == _clip:
		return
	_clip = clip
	soldier.play(clip, 0.2)


func _die(killer: Node) -> void:
	alive = false
	_target = null
	_flash.visible = false
	collision_layer = 0
	collision_mask = 1
	_agent.avoidance_enabled = false
	_agent.velocity = Vector3.ZERO
	var clip := "Death_Back" if randf() < 0.5 else "Death_Forward"
	_clip = clip
	soldier.animator.play(clip, 0.15)
	died.emit(self, killer)
	get_tree().create_timer(14.0, false).timeout.connect(queue_free)
