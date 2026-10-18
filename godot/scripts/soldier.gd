class_name Soldier
extends Node3D
## Боец из .glb: проигрывает анимации и держит оружие.
##
## Пример:
##     var soldier := Soldier.new()
##     soldier.model = preload("res://assets/models/soldier_alliance.glb")
##     add_child(soldier)
##     soldier.equip(preload("res://assets/models/rifle.glb"))
##     soldier.play("Rifle_Jog_Forward")
##
## Клипы Rifle_* подходят к любому длинноствольному оружию: у автомата,
## винтовки, пулемёта и снайперки одинаковая геометрия хвата.

## Одноразовые клипы; все остальные зациклены (в glTF флага зацикливания нет).
const ONE_SHOT := [
	"Rifle_Jump_Start",
	"Rifle_Jump_Land",
	"Rifle_Reload",
	"Pistol_Reload",
	"Bandage",
	"Hit",
	"Death_Back",
	"Death_Forward",
]

## Сцена бойца (.glb).
@export var model: PackedScene
## Бинт, который боец достаёт в клипе Bandage.
@export var bandage_model: PackedScene = preload("res://assets/models/bandage.glb")

var body: Node3D
var animator: AnimationPlayer
var weapon: Node3D
var weapon_animator: AnimationPlayer
var _bandage: Node3D


func _ready() -> void:
	body = model.instantiate()
	add_child(body)
	animator = body.find_child("AnimationPlayer", true, false) as AnimationPlayer
	for clip_name in animator.get_animation_list():
		var clip := animator.get_animation(clip_name)
		clip.loop_mode = Animation.LOOP_NONE if clip_name in ONE_SHOT else Animation.LOOP_LINEAR
	animator.animation_finished.connect(_on_animation_finished)


## Вложить оружие в правую руку: узел grip_r оружия совмещается с гнездом socket_weapon_r.
func equip(weapon_scene: PackedScene) -> void:
	if weapon:
		weapon.queue_free()
	weapon = weapon_scene.instantiate()
	_attach(weapon, "socket_weapon_r")
	weapon_animator = weapon.find_child("AnimationPlayer", true, false) as AnimationPlayer
	if weapon_animator and weapon_animator.has_animation("Fire"):
		weapon_animator.get_animation("Fire").loop_mode = Animation.LOOP_LINEAR


## Проиграть клип с плавным переходом. Перезарядка и выстрел запускают
## одноимённые анимации оружия, перевязка — достаёт бинт в левую руку.
func play(clip: String, blend := 0.2) -> void:
	animator.play(clip, blend)
	_hold_bandage(clip == "Bandage")
	if not weapon_animator:
		return
	if clip.ends_with("_Reload") and weapon_animator.has_animation("Reload"):
		weapon_animator.play("Reload")
	elif clip.ends_with("_Fire") and weapon_animator.has_animation("Fire"):
		weapon_animator.play("Fire")
	elif weapon_animator.is_playing():
		weapon_animator.stop()


func _on_animation_finished(clip: StringName) -> void:
	if clip == &"Bandage":
		_hold_bandage(false)


func _hold_bandage(on: bool) -> void:
	if on and not _bandage:
		_bandage = bandage_model.instantiate()
		var tail := _bandage.find_child("tail", true, false) as Node3D
		if tail:
			tail.visible = false
		_attach(_bandage, "socket_weapon_l")
	elif not on and _bandage:
		_bandage.queue_free()
		_bandage = null


## Повесить предмет в гнездо так, чтобы его узел grip_r совпал с гнездом.
func _attach(item: Node3D, socket_name: String) -> void:
	var socket := body.find_child(socket_name, true, false) as Node3D
	socket.add_child(item)
	var grip := item.find_child("grip_r", true, false) as Node3D
	item.transform = _relative(grip, item).affine_inverse()


## Трансформация узла node относительно его предка root.
static func _relative(node: Node, root: Node) -> Transform3D:
	var result := Transform3D.IDENTITY
	var current := node
	while current and current != root:
		if current is Node3D:
			result = (current as Node3D).transform * result
		current = current.get_parent()
	return result
