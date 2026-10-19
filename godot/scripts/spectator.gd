extends CharacterBody3D
## Наблюдатель для осмотра карты: летает (по умолчанию) или ходит пешком.
##
## Правая кнопка мыши — смотреть, WASD — двигаться, Q/E — вниз/вверх,
## Shift — быстрее, колесо — скорость полёта, F — полёт/пешком,
## пробел — прыжок (пешком). Пешком действуют гравитация и столкновения:
## так удобно проверить, где можно пройти.

const GRAVITY := 20.0
const JUMP_SPEED := 6.5
const WALK_SPEED := 4.5
const RUN_SPEED := 8.0

@export var fly_speed := 14.0
@export var sensitivity := 0.2
## Куда вернуть наблюдателя, если он провалился под карту.
@export var respawn := Vector3(0, 1, -52)

var flying := true
var _yaw := 0.0
var _pitch := 0.0

@onready var camera: Camera3D = $Camera
@onready var shape: CollisionShape3D = $Shape


func _ready() -> void:
	_yaw = rotation_degrees.y
	_pitch = camera.rotation_degrees.x
	floor_max_angle = deg_to_rad(60.0)  # бордюры по 15 см берутся «с ходу»
	_set_flying(true)


func _set_flying(on: bool) -> void:
	flying = on
	shape.disabled = on
	velocity = Vector3.ZERO


func _unhandled_input(event: InputEvent) -> void:
	var button := event as InputEventMouseButton
	if button:
		if button.button_index == MOUSE_BUTTON_RIGHT:
			Input.mouse_mode = (
				Input.MOUSE_MODE_CAPTURED if button.pressed else Input.MOUSE_MODE_VISIBLE
			)
		elif button.pressed and button.button_index == MOUSE_BUTTON_WHEEL_UP:
			fly_speed = minf(fly_speed * 1.25, 150.0)
		elif button.pressed and button.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			fly_speed = maxf(fly_speed / 1.25, 2.0)
	var motion := event as InputEventMouseMotion
	if motion and Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		_yaw -= motion.relative.x * sensitivity
		_pitch = clampf(_pitch - motion.relative.y * sensitivity, -89.0, 89.0)
		rotation_degrees = Vector3(0, _yaw, 0)
		camera.rotation_degrees = Vector3(_pitch, 0, 0)
	var key := event as InputEventKey
	if key and key.pressed and not key.echo and key.physical_keycode == KEY_F:
		_set_flying(not flying)


func _physics_process(delta: float) -> void:
	var input := Vector3.ZERO
	if Input.is_physical_key_pressed(KEY_W):
		input.z -= 1
	if Input.is_physical_key_pressed(KEY_S):
		input.z += 1
	if Input.is_physical_key_pressed(KEY_A):
		input.x -= 1
	if Input.is_physical_key_pressed(KEY_D):
		input.x += 1
	var fast := Input.is_physical_key_pressed(KEY_SHIFT)

	if flying:
		var direction := camera.global_transform.basis * input
		if Input.is_physical_key_pressed(KEY_E):
			direction.y += 1
		if Input.is_physical_key_pressed(KEY_Q):
			direction.y -= 1
		if direction.length() > 0.01:
			global_position += direction.normalized() * fly_speed * (3.0 if fast else 1.0) * delta
		return

	var wish := global_transform.basis * Vector3(input.x, 0, input.z)
	if wish.length() > 0.01:
		wish = wish.normalized() * (RUN_SPEED if fast else WALK_SPEED)
	velocity.x = wish.x
	velocity.z = wish.z
	if is_on_floor():
		if Input.is_physical_key_pressed(KEY_SPACE):
			velocity.y = JUMP_SPEED
	else:
		velocity.y -= GRAVITY * delta
	move_and_slide()
	if global_position.y < -20.0:
		global_position = respawn
		velocity = Vector3.ZERO
