class_name Effects
extends RefCounted
## Эффекты стрельбы: вспышка у дула, след от пули на стене, облачко пыли.

const MAX_MARKS := 80

static var _flash_material: StandardMaterial3D
static var _hole: GradientTexture2D
static var _dust: SphereMesh
static var _blood: SphereMesh
static var _marks: Array = []


## Материал вспышки: светящееся пятно, всегда повёрнутое к камере.
static func flash_material() -> StandardMaterial3D:
	if _flash_material == null:
		var glow := Gradient.new()
		glow.offsets = PackedFloat32Array([0.0, 0.3, 1.0])
		glow.colors = PackedColorArray(
			[Color(1, 0.96, 0.82, 1), Color(1, 0.66, 0.28, 0.85), Color(1, 0.42, 0.1, 0)]
		)
		var texture := GradientTexture2D.new()
		texture.gradient = glow
		texture.fill = GradientTexture2D.FILL_RADIAL
		texture.fill_from = Vector2(0.5, 0.5)
		texture.fill_to = Vector2(1.0, 0.5)
		_flash_material = StandardMaterial3D.new()
		_flash_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		_flash_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
		_flash_material.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		_flash_material.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
		_flash_material.albedo_texture = texture
	return _flash_material


## Вспышка у дула: светящийся квадрат и короткий свет. Изначально скрыта.
static func make_flash() -> Node3D:
	var flash := Node3D.new()
	var quad := MeshInstance3D.new()
	var mesh := QuadMesh.new()
	mesh.size = Vector2(0.4, 0.4)
	mesh.material = flash_material()
	quad.mesh = mesh
	quad.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	flash.add_child(quad)
	var light := OmniLight3D.new()
	light.light_color = Color(1.0, 0.72, 0.4)
	light.light_energy = 3.0
	light.omni_range = 6.0
	flash.add_child(light)
	flash.visible = false
	return flash


static func hole_texture() -> GradientTexture2D:
	if _hole == null:
		var spot := Gradient.new()
		spot.offsets = PackedFloat32Array([0.0, 0.28, 0.5, 1.0])
		spot.colors = PackedColorArray(
			[
				Color(0.03, 0.03, 0.03, 1),
				Color(0.06, 0.06, 0.05, 0.95),
				Color(0.22, 0.2, 0.17, 0.45),
				Color(0, 0, 0, 0),
			]
		)
		_hole = GradientTexture2D.new()
		_hole.gradient = spot
		_hole.fill = GradientTexture2D.FILL_RADIAL
		_hole.fill_from = Vector2(0.5, 0.5)
		_hole.fill_to = Vector2(1.0, 0.5)
		_hole.width = 64
		_hole.height = 64
	return _hole


static func dust_mesh() -> SphereMesh:
	if _dust == null:
		_dust = SphereMesh.new()
		_dust.radius = 0.03
		_dust.height = 0.06
		_dust.radial_segments = 6
		_dust.rings = 3
		var material := StandardMaterial3D.new()
		material.albedo_color = Color(0.5, 0.47, 0.42)
		material.roughness = 1.0
		_dust.material = material
	return _dust


## Базис, у которого ось Y смотрит по нормали поверхности.
static func surface_basis(normal: Vector3) -> Basis:
	var y := normal.normalized()
	var helper := Vector3.RIGHT if absf(y.x) < 0.9 else Vector3.FORWARD
	var x := (helper - y * helper.dot(y)).normalized()
	return Basis(x, y, x.cross(y))


## Выстрел через центр экрана: луч до первого препятствия (стены или бойца).
## spread — разброс в радианах. Возвращает { end, hit, normal, collider }:
## куда долетела пуля и во что попала. След или кровь рисует вызывающий.
static func shoot(shooter: CollisionObject3D, camera: Camera3D, spread: float) -> Dictionary:
	var center := camera.get_viewport().get_visible_rect().size * 0.5
	var origin := camera.project_ray_origin(center)
	var direction := camera.project_ray_normal(center)
	var axes := camera.global_transform.basis
	direction = direction.rotated(axes.x, randf_range(-spread, spread))
	direction = direction.rotated(axes.y, randf_range(-spread, spread))
	var query := PhysicsRayQueryParameters3D.create(origin, origin + direction * 900.0, 3)
	var exclude: Array[RID] = [shooter.get_rid()]
	query.exclude = exclude
	var hit := shooter.get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty():
		return {
			"end": origin + direction * 300.0, "hit": false, "normal": Vector3.UP, "collider": null
		}
	return {"end": hit.position, "hit": true, "normal": hit.normal, "collider": hit.collider}


## След от пули (декаль) и облачко пыли в точке попадания.
static func impact(root: Node, point: Vector3, normal: Vector3) -> void:
	var axes := surface_basis(normal)
	var mark := Decal.new()
	mark.texture_albedo = hole_texture()
	mark.size = Vector3(0.14, 0.3, 0.14)
	root.add_child(mark)
	mark.global_transform = Transform3D(axes, point)
	_marks.append(mark)
	while _marks.size() > MAX_MARKS:
		var old = _marks.pop_front()  # после смены сцены узел мог быть уже удалён
		if is_instance_valid(old):
			old.queue_free()

	var dust := CPUParticles3D.new()
	dust.one_shot = true
	dust.amount = 10
	dust.lifetime = 0.7
	dust.explosiveness = 0.95
	dust.direction = Vector3.UP
	dust.spread = 40.0
	dust.initial_velocity_min = 0.8
	dust.initial_velocity_max = 2.2
	dust.gravity = Vector3(0, -3.0, 0)
	dust.scale_amount_min = 0.6
	dust.scale_amount_max = 1.3
	dust.mesh = dust_mesh()
	root.add_child(dust)
	dust.global_transform = Transform3D(axes, point + normal * 0.03)
	dust.emitting = true
	root.get_tree().create_timer(1.5).timeout.connect(dust.queue_free)


## Попадание в бойца: брызги крови и пыли с формы.
static func blood(root: Node, point: Vector3, normal: Vector3) -> void:
	var puff := CPUParticles3D.new()
	puff.one_shot = true
	puff.amount = 12
	puff.lifetime = 0.45
	puff.explosiveness = 1.0
	puff.direction = normal
	puff.spread = 35.0
	puff.initial_velocity_min = 1.0
	puff.initial_velocity_max = 2.8
	puff.gravity = Vector3(0, -6.0, 0)
	puff.scale_amount_min = 0.5
	puff.scale_amount_max = 1.2
	puff.mesh = blood_mesh()
	root.add_child(puff)
	puff.global_position = point
	puff.emitting = true
	root.get_tree().create_timer(1.0, false).timeout.connect(puff.queue_free)


static func blood_mesh() -> SphereMesh:
	if _blood == null:
		_blood = SphereMesh.new()
		_blood.radius = 0.025
		_blood.height = 0.05
		_blood.radial_segments = 6
		_blood.rings = 3
		var material := StandardMaterial3D.new()
		material.albedo_color = Color(0.32, 0.04, 0.03)
		material.roughness = 0.5
		_blood.material = material
	return _blood
