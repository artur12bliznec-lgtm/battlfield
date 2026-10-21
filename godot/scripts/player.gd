class_name Player
extends CharacterBody3D
## Боец игрока, вид от третьего лица из-за плеча.
##
## WASD — двигаться, Shift — спринт, C или Ctrl — присесть, Z — лечь,
## пробел — прыжок (или встать), ЛКМ — стрелять, ПКМ — целиться,
## R — перезарядка, 1–5 или колесо — оружие, 6 или H — перевязка.
##
## Ходьба и бег в клипах сделаны на месте, бойца двигает код. Скорости ниже
## совпадают с шагом в анимации — ноги не скользят.

enum Stance { STAND, CROUCH, PRONE }

const GRAVITY := 18.0
const JUMP_SPEED := 5.0
const WALK := 1.02
const JOG := 2.65
const SPRINT := 4.51
const CROUCH_SPEED := 0.7
const CRAWL := 0.6
## На какую высоту боец сам «перешагивает» (бордюр, ступенька).
const STEP := 0.4
## Высота камеры и капсулы для стойки: стоя, присев, лёжа.
const EYE := [1.68, 1.15, 0.6]
const BODY := [1.8, 1.25, 0.7]
const PITCH_MIN := -1.25
const PITCH_MAX := 1.1

## Команда: ключ из Game.TEAMS.
var team := "alliance"
var stance := Stance.STAND
var aiming := false
var sprinting := false
## Ячейка инвентаря в руках (0–4 — оружие, 5 — бинт).
var slot := -1
## Инвентарь: копии Arsenal.ITEMS с патронами (ammo, reserve) и счётчиками.
var items: Array[Dictionary] = []
## Что боец сейчас делает: "" — свободен, reload, bandage, swap, land.
var action := ""
## Стоит ли на точке захвата (выставляет карта).
var on_point := false
## Открыто меню или инвентарь — боец не слушает клавиши и мышь.
var blocked := false

var soldier: Soldier
var camera: Camera3D
var _pivot: Node3D
var _arm: SpringArm3D
var _shape: CollisionShape3D
var _capsule: CapsuleShape3D
var _yaw := 0.0
var _pitch := 0.0
## Игровые часы: на паузе стоят, поэтому перезарядка и перевязка тоже ждут.
var _clock := 0.0
var _action_until := 0.0
var _next_shot := 0.0
var _firing_until := 0.0
var _clip := ""
var _clip_backwards := false
var _flash: Node3D
var _flash_until := 0.0
var _gun_audio: AudioStreamPlayer
var _shots_fired := 0
var _burst := 0
## Сколько секунд боец не касается земли.
var _air_time := 0.0
var _spawn := Transform3D.IDENTITY
var _model_yaw := PI


func _ready() -> void:
	_spawn = global_transform
	_yaw = rotation.y
	floor_max_angle = deg_to_rad(50.0)
	floor_snap_length = 0.35

	_capsule = CapsuleShape3D.new()
	_capsule.radius = 0.35
	_capsule.height = BODY[0]
	_shape = CollisionShape3D.new()
	_shape.shape = _capsule
	_shape.position.y = BODY[0] * 0.5
	add_child(_shape)

	soldier = Soldier.new()
	soldier.model = load(Game.TEAMS[team].model)
	soldier.rotation.y = PI  # модель смотрит на +Z, а «вперёд» у бойца — −Z
	add_child(soldier)

	_pivot = Node3D.new()
	_pivot.position.y = EYE[0]
	add_child(_pivot)
	_arm = SpringArm3D.new()
	_arm.position.x = 0.62  # камера над правым плечом
	_arm.spring_length = 2.8
	_arm.margin = 0.2
	var probe := SphereShape3D.new()
	probe.radius = 0.2
	_arm.shape = probe
	_arm.add_excluded_object(get_rid())
	_pivot.add_child(_arm)
	camera = Camera3D.new()
	camera.fov = 70.0
	camera.far = 2000.0
	_arm.add_child(camera)
	camera.make_current()

	_gun_audio = AudioStreamPlayer.new()
	_gun_audio.max_polyphony = 6
	_gun_audio.volume_db = -3.0
	add_child(_gun_audio)

	for item in Arsenal.ITEMS:
		var state: Dictionary = item.duplicate()
		if item.kind != "item":
			state.ammo = item.capacity
			state.reserve = item.capacity * item.magazines
		items.append(state)
	equip(0)
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED


func _unhandled_input(event: InputEvent) -> void:
	if blocked:
		return
	var motion := event as InputEventMouseMotion
	if motion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		var k := 0.0022 * camera.fov / 70.0  # в прицеле мышь медленнее
		_yaw -= motion.relative.x * k
		_pitch = clampf(_pitch - motion.relative.y * k, PITCH_MIN, PITCH_MAX)
		_look()  # сразу, не дожидаясь шага физики: на мониторах 144 Гц обзор плавнее
		return
	var button := event as InputEventMouseButton
	if button:
		_on_button(button)
		return
	var key := event as InputEventKey
	if key and key.pressed and not key.echo:
		_on_key(key.physical_keycode)


func _on_button(button: InputEventMouseButton) -> void:
	match button.button_index:
		MOUSE_BUTTON_LEFT:
			if button.pressed and not items[slot].get("auto", false):
				_fire()
		MOUSE_BUTTON_RIGHT:
			aiming = button.pressed
		MOUSE_BUTTON_WHEEL_UP:
			if button.pressed:
				equip(wrapi(slot - 1, 0, 5))
		MOUSE_BUTTON_WHEEL_DOWN:
			if button.pressed:
				equip(wrapi(slot + 1, 0, 5))


func _on_key(code: Key) -> void:
	match code:
		KEY_1, KEY_2, KEY_3, KEY_4, KEY_5:
			equip(code - KEY_1)
		KEY_6, KEY_H:
			bandage()
		KEY_R:
			reload()
		KEY_C, KEY_CTRL:
			_set_stance(Stance.STAND if stance == Stance.CROUCH else Stance.CROUCH)
		KEY_Z:
			_set_stance(Stance.STAND if stance == Stance.PRONE else Stance.PRONE)
		KEY_SPACE:
			if stance != Stance.STAND:
				_set_stance(Stance.STAND)
			elif is_on_floor() and action == "":
				velocity.y = JUMP_SPEED


func _physics_process(delta: float) -> void:
	_clock += delta
	var now := _now()
	if action != "" and now >= _action_until:
		_finish_action()
	_look()

	var input := Vector2.ZERO
	if not blocked:
		input.y = _axis(KEY_W, KEY_S)
		input.x = _axis(KEY_D, KEY_A)
	input = input.limit_length(1.0)
	if action == "bandage":
		input = Vector2.ZERO
	sprinting = (
		not blocked
		and Input.is_physical_key_pressed(KEY_SHIFT)
		and input.y > 0.5
		and stance == Stance.STAND
		and not aiming
		and action != "reload"
	)
	if sprinting:
		input = Vector2(0, 1)  # спринт — только вперёд

	var wish := transform.basis * Vector3(input.x, 0, -input.y) * _speed()
	velocity.x = wish.x
	velocity.z = wish.z
	if not is_on_floor():
		velocity.y -= GRAVITY * delta
	move_and_slide()
	if is_on_floor() and is_on_wall() and wish.length() > 0.1:
		_step_up(Vector3(wish.x, 0, wish.z) * delta)
	if is_on_floor():
		# приземление — только после настоящего прыжка или падения, не после бордюра
		if _air_time > 0.3 and stance == Stance.STAND and action == "":
			_start("land", 0.25)
		_air_time = 0.0
	else:
		_air_time += delta
	if global_position.y < -20.0:  # провалился — обратно на место появления
		global_transform = _spawn
		_yaw = rotation.y
		velocity = Vector3.ZERO

	if not blocked and Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT):
		if items[slot].get("auto", false):
			_fire()
	# после очереди звенят гильзы
	if _burst > 0 and now > _firing_until + 0.15:
		if _burst >= 4:
			Sfx.play(self, "casings", -16.0)
		_burst = 0
	_update_camera(delta)
	_animate(input, now, delta)
	if _flash and now > _flash_until:
		_flash.visible = false


## Взять в руки оружие из ячейки index (0–4).
func equip(index: int) -> void:
	index = clampi(index, 0, 4)
	if index == slot or action == "bandage":
		return
	if action == "reload":
		action = ""
	slot = index
	soldier.equip(Arsenal.scene(items[slot]))
	_gun_audio.stream = Sfx.stream("shot_" + str(items[slot].id))
	var anim := soldier.weapon_animator
	if anim:
		# не сбрасывать дорожки, которых нет в клипе: сошки при перезарядке лёжа
		anim.deterministic = false
		if anim.has_animation("Fire"):
			anim.get_animation("Fire").loop_mode = Animation.LOOP_NONE
	_flash = null
	var muzzle := soldier.weapon.find_child("muzzle", true, false) as Node3D
	if muzzle:
		_flash = Effects.make_flash()
		muzzle.add_child(_flash)
	if stance == Stance.PRONE:
		_bipod(true)
	_start("swap", 0.35)
	_clip = ""


## Перезарядить оружие в руках.
func reload() -> void:
	var item: Dictionary = items[slot]
	if item.kind == "item" or action != "" or item.ammo >= item.capacity or item.reserve <= 0:
		return
	var clip := ("Pistol_" if item.kind == "pistol" else "Rifle_") + "Reload"
	_start("reload", soldier.animator.get_animation(clip).length)
	Sfx.play(self, "reload_pistol" if item.kind == "pistol" else "reload_rifle", -6.0)
	var anim := soldier.weapon_animator
	if anim and anim.has_animation("Reload"):
		anim.play("Reload")


## Перевязка: боец встаёт, достаёт бинт и обматывает руку.
func bandage() -> void:
	var item: Dictionary = items[5]
	if action != "" or item.count <= 0 or not is_on_floor():
		return
	item.count -= 1
	_set_stance(Stance.STAND)
	aiming = false
	_start("bandage", soldier.animator.get_animation("Bandage").length)
	soldier.hold_bandage(true)
	Sfx.play(self, "bandage", -8.0)


## Смотрит ли игрок в оптический прицел (тогда бойца не видно, а на экране — прицел).
func is_scoped() -> bool:
	return aiming and items[slot].get("scope", false) and action != "reload" and camera.fov < 30.0


func _look() -> void:
	rotation.y = _yaw
	_pivot.rotation.x = _pitch


func _now() -> float:
	return _clock


func _axis(plus: Key, minus: Key) -> float:
	return float(Input.is_physical_key_pressed(plus)) - float(Input.is_physical_key_pressed(minus))


func _start(what: String, duration: float) -> void:
	action = what
	_action_until = _now() + duration


func _finish_action() -> void:
	if action == "reload":
		var item: Dictionary = items[slot]
		var take := mini(item.capacity - item.ammo, item.reserve)
		item.ammo += take
		item.reserve -= take
	elif action == "bandage":
		soldier.hold_bandage(false)
	action = ""


func _speed() -> float:
	if action == "bandage":
		return 0.0
	match stance:
		Stance.CROUCH:
			return CROUCH_SPEED
		Stance.PRONE:
			return CRAWL
	if sprinting:
		return SPRINT
	return WALK if aiming else JOG


func _set_stance(next: Stance) -> void:
	if next == stance or action == "bandage":
		return
	var was_prone := stance == Stance.PRONE
	stance = next
	_capsule.height = BODY[next]
	_shape.position.y = BODY[next] * 0.5
	if was_prone != (next == Stance.PRONE):
		_bipod(next == Stance.PRONE)


## Сошки у пулемёта и снайперки: лёжа — разложить, встав — сложить.
func _bipod(deploy: bool) -> void:
	var anim := soldier.weapon_animator
	if not anim or not anim.has_animation("Bipod_Deploy"):
		return
	if deploy:
		anim.play("Bipod_Deploy")
	else:
		anim.play_backwards("Bipod_Deploy")


## Подняться на невысокое препятствие (бордюр), если упёрлись в него.
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


func _fire() -> void:
	var item: Dictionary = items[slot]
	var now := _now()
	if item.kind == "item" or action != "" or sprinting or now < _next_shot:
		return
	if item.ammo <= 0:
		if now >= _next_shot:
			Sfx.play(self, "dry_fire", -4.0)
			_next_shot = now + 0.25
		reload()
		return
	item.ammo -= 1
	_shots_fired += 1
	_burst += 1
	_next_shot = now + 60.0 / float(item.rpm)
	_firing_until = now + 0.15
	var spread := deg_to_rad(item.spread) * (0.3 if aiming else 1.0)
	if stance != Stance.STAND:
		spread *= 0.6
	if Vector2(velocity.x, velocity.z).length() > 0.5:
		spread *= 1.8
	var shot := Effects.shoot(self, camera, spread)
	_gun_audio.pitch_scale = randf_range(0.97, 1.03)
	_gun_audio.play()
	if _flash:
		_flash.visible = true
		_flash_until = now + 0.045
		# трассер — каждый третий патрон, у пулемёта — каждый второй
		if _shots_fired % (2 if item.id == "machine_gun" else 3) == 0:
			BattleFx.tracer(get_tree().current_scene, _flash.global_position, shot.end)
	if shot.hit:
		var sound := "ricochet_1" if randf() < 0.1 else "impact_%d" % randi_range(1, 2)
		Sfx.play_at(get_tree().current_scene, sound, shot.end, -8.0, 4.0)
	var anim := soldier.weapon_animator
	if anim and anim.has_animation("Fire"):
		anim.stop()
		anim.play("Fire")
	var kick: float = item.recoil * (0.45 if stance == Stance.PRONE else 1.0)
	_pitch = clampf(_pitch + deg_to_rad(kick), PITCH_MIN, PITCH_MAX)
	_yaw += deg_to_rad(randf_range(-0.35, 0.35) * kick)
	_look()


func _update_camera(delta: float) -> void:
	var item: Dictionary = items[slot]
	var aim := aiming and action != "reload" and not sprinting
	var fov: float = item.get("aim_fov", 70.0) if aim else 70.0
	camera.fov = lerpf(camera.fov, fov, minf(1.0, delta * 14.0))
	_arm.spring_length = lerpf(_arm.spring_length, 1.25 if aim else 2.8, minf(1.0, delta * 10.0))
	_pivot.position.y = lerpf(_pivot.position.y, EYE[stance], minf(1.0, delta * 8.0))
	soldier.visible = not is_scoped()


func _animate(input: Vector2, now: float, delta: float) -> void:
	var clip := _pick_clip(input, now)
	var backwards := clip.begins_with("-")
	if backwards:
		clip = clip.substr(1)
	if clip != _clip or backwards != _clip_backwards:
		_clip = clip
		_clip_backwards = backwards
		if backwards:
			soldier.animator.play_backwards(clip, 0.2)
		else:
			soldier.animator.play(clip, 0.2)
	# у пистолета нет клипов шага вбок: идём боком «лицом по ходу»
	var target := PI
	var sideways := absf(input.x) > absf(input.y)
	if (
		items[slot].kind == "pistol"
		and stance == Stance.STAND
		and input.length() > 0.1
		and sideways
	):
		target = PI + (PI * 0.5 if input.x < 0 else -PI * 0.5)
	_model_yaw = lerp_angle(_model_yaw, target, minf(1.0, delta * 10.0))
	soldier.rotation.y = _model_yaw


## Какой клип играть сейчас. Минус в начале — играть задом наперёд.
func _pick_clip(input: Vector2, now: float) -> String:
	var moving := input.length() > 0.1
	var special := _action_clip(moving)
	if special != "":
		return special
	if stance != Stance.STAND:
		return _low_clip(moving, _direction(input))
	return _stand_clip(moving, _direction(input), now)


## Перевязка, перезарядка, прыжок и приземление — или "" если ничего из этого.
func _action_clip(moving: bool) -> String:
	var pistol: bool = items[slot].kind == "pistol"
	var clip := ""
	if action == "bandage":
		clip = "Bandage"
	elif action == "reload" and not moving and stance == Stance.STAND:
		clip = ("Pistol_" if pistol else "Rifle_") + "Reload"
	elif stance == Stance.STAND and _airborne():
		clip = "Rifle_Jump_Start" if velocity.y > 1.0 else "Rifle_Jump_Fall"
	elif action == "land":
		clip = "Rifle_Jump_Land"
	if pistol and clip.begins_with("Rifle_Jump"):
		clip = "Pistol_Idle"
	return clip


## Присед и «лёжа».
func _low_clip(moving: bool, direction: String) -> String:
	if stance == Stance.PRONE:
		return "Rifle_Prone_Crawl" if moving else "Rifle_Prone_Idle"
	if moving:
		return "Rifle_Crouch_Walk_" + direction
	return ("Pistol_" if items[slot].kind == "pistol" else "Rifle_") + "Crouch_Idle"


## Стоя: шаг с прицелом, бег, спринт, стрельба, прицел или стойка.
func _stand_clip(moving: bool, direction: String, now: float) -> String:
	var pistol: bool = items[slot].kind == "pistol"
	var p := "Pistol_" if pistol else "Rifle_"
	var clip := p + "Idle"
	if moving and sprinting:
		clip = "Pistol_Jog_Forward" if pistol else "Rifle_Sprint"
	elif moving:
		var gait := "Walk_" if aiming else "Jog_"
		if pistol:
			clip = ("-" if direction == "Backward" else "") + "Pistol_" + gait + "Forward"
		else:
			clip = "Rifle_" + gait + direction
	elif now < _firing_until:
		clip = p + "Fire"
	elif aiming or now < _firing_until + 1.0:
		clip = p + "Aim"
	return clip


## В воздухе по-настоящему: прыжок или падение, а не миг над бордюром.
func _airborne() -> bool:
	return not is_on_floor() and (velocity.y > 1.0 or _air_time > 0.15)


func _direction(input: Vector2) -> String:
	if absf(input.x) > absf(input.y):
		return "Right" if input.x > 0 else "Left"
	return "Forward" if input.y >= 0 else "Backward"
