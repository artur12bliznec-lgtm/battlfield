class_name BattleFx
extends RefCounted
## Эффекты боя на частицах: пожары, дым, разрывы, трассеры, осветительные
## ракеты, пепел в воздухе. Текстуры дыма и пламени (атласы 2×2) рисует
## scripts/make-fx.mjs.

const SMOKE_TEXTURE := "res://assets/fx/smoke.png"
const FIRE_TEXTURE := "res://assets/fx/fire.png"
## Ветер: куда сносит дым (на восток и немного на юг).
const WIND := Vector3(1.0, 0.0, 0.35)

static var _materials := {}

# --- материалы и кривые -------------------------------------------------


## Материал частиц: всегда лицом к камере, цвет из частицы, атлас 2×2.
static func particle_material(kind: String) -> StandardMaterial3D:
	if _materials.has(kind):
		return _materials[kind]
	var m := StandardMaterial3D.new()
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.vertex_color_use_as_albedo = true
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	m.billboard_keep_scale = true
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	match kind:
		"smoke":
			m.albedo_texture = load(SMOKE_TEXTURE)
			m.particles_anim_h_frames = 2
			m.particles_anim_v_frames = 2
			m.proximity_fade_enabled = true
			m.proximity_fade_distance = 1.5
		"fire":
			m.albedo_texture = load(FIRE_TEXTURE)
			m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
			m.particles_anim_h_frames = 2
			m.particles_anim_v_frames = 2
			m.proximity_fade_enabled = true
			m.proximity_fade_distance = 0.6
		"spark":
			m.albedo_texture = glow_texture()
			m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		"debris":
			m.transparency = BaseMaterial3D.TRANSPARENCY_DISABLED
			m.shading_mode = BaseMaterial3D.SHADING_MODE_PER_PIXEL
			m.billboard_mode = BaseMaterial3D.BILLBOARD_DISABLED
			m.albedo_color = Color(0.2, 0.19, 0.18)
	_materials[kind] = m
	return m


## Светящееся пятно: радиальный градиент от белого к прозрачному.
static func glow_texture() -> GradientTexture2D:
	var glow := Gradient.new()
	glow.offsets = PackedFloat32Array([0.0, 0.25, 1.0])
	glow.colors = PackedColorArray([Color(1, 1, 1, 1), Color(1, 1, 1, 0.6), Color(1, 1, 1, 0)])
	var texture := GradientTexture2D.new()
	texture.gradient = glow
	texture.fill = GradientTexture2D.FILL_RADIAL
	texture.fill_from = Vector2(0.5, 0.5)
	texture.fill_to = Vector2(1.0, 0.5)
	texture.width = 32
	texture.height = 32
	return texture


## Светящийся материал (трассеры, ракеты): ярче белого — его подхватывает свечение.
static func glow_material(color: Color, energy: float) -> StandardMaterial3D:
	var key := "glow_%s_%s" % [color.to_html(), energy]
	if _materials.has(key):
		return _materials[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = Color.BLACK
	m.emission_enabled = true
	m.emission = color
	m.emission_energy_multiplier = energy
	m.disable_receive_shadows = true
	_materials[key] = m
	return m


static func _curve(points: Array, top := 1.0) -> CurveTexture:
	var curve := Curve.new()
	curve.max_value = top
	for p: Vector2 in points:
		curve.add_point(p)
	var texture := CurveTexture.new()
	texture.curve = curve
	return texture


static func _ramp(colors: Array, offsets: Array) -> GradientTexture1D:
	var gradient := Gradient.new()
	gradient.offsets = PackedFloat32Array(offsets)
	gradient.colors = PackedColorArray(colors)
	var texture := GradientTexture1D.new()
	texture.gradient = gradient
	return texture


## Система частиц: quad — размер картинки, kind — материал (smoke, fire, spark).
static func _particles(
	amount: int, lifetime: float, quad: Vector2, kind: String, box: AABB
) -> GPUParticles3D:
	var p := GPUParticles3D.new()
	p.amount = maxi(1, amount)
	p.lifetime = lifetime
	p.randomness = 0.4
	p.fixed_fps = 30
	p.draw_order = GPUParticles3D.DRAW_ORDER_VIEW_DEPTH
	p.visibility_aabb = box
	p.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var mesh := QuadMesh.new()
	mesh.size = quad
	mesh.material = particle_material(kind)
	p.draw_pass_1 = mesh
	return p


static func _process_material(direction: Vector3, spread: float) -> ParticleProcessMaterial:
	var m := ParticleProcessMaterial.new()
	m.direction = direction
	m.spread = spread
	m.angle_min = 0.0
	m.angle_max = 360.0
	m.anim_offset_min = 0.0
	m.anim_offset_max = 1.0
	return m


# --- дым и огонь --------------------------------------------------------


## Столб дыма от большого пожара: густой у основания, тёмный, сносит ветром.
static func smoke_column(size := 1.0) -> GPUParticles3D:
	var h := 60.0 * size
	var p := _particles(
		int(64 * clampf(size, 0.6, 2.5)),
		18.0,
		Vector2(2, 2),
		"smoke",
		AABB(Vector3(-h * 0.5, -2, -h * 0.5), Vector3(h * 1.4, h, h))
	)
	p.preprocess = 18.0
	var m := _process_material(Vector3.UP, 8.0)
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	m.emission_sphere_radius = 0.8 * size
	m.initial_velocity_min = 2.4 * size
	m.initial_velocity_max = 3.4 * size
	m.gravity = WIND * 0.3 * size + Vector3(0, 0.15, 0)
	m.damping_min = 0.1
	m.damping_max = 0.2
	m.scale_min = 2.6 * size
	m.scale_max = 3.8 * size
	m.scale_curve = _curve([Vector2(0, 0.35), Vector2(0.35, 1.0), Vector2(1, 2.4)], 2.5)
	m.angular_velocity_min = -10.0
	m.angular_velocity_max = 10.0
	m.color_ramp = _ramp(
		[
			Color(0.05, 0.045, 0.04, 0.0),
			Color(0.06, 0.055, 0.05, 1.0),
			Color(0.15, 0.14, 0.13, 0.85),
			Color(0.3, 0.29, 0.28, 0.0),
		],
		[0.0, 0.05, 0.55, 1.0]
	)
	m.turbulence_enabled = true
	m.turbulence_noise_strength = 2.0
	m.turbulence_noise_scale = 5.0
	m.turbulence_influence_min = 0.02
	m.turbulence_influence_max = 0.06
	p.process_material = m
	return p


## Тление: редкий серый дымок над сгоревшей машиной.
static func smolder(size := 1.0) -> GPUParticles3D:
	var p := _particles(
		int(16 * clampf(size, 0.5, 2.0)),
		9.0,
		Vector2(1.6, 1.6),
		"smoke",
		AABB(Vector3(-8, -1, -8), Vector3(22, 22, 16))
	)
	p.preprocess = 9.0
	var m := _process_material(Vector3.UP, 12.0)
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	m.emission_sphere_radius = 0.6 * size
	m.initial_velocity_min = 0.9
	m.initial_velocity_max = 1.5
	m.gravity = WIND * 0.18 + Vector3(0, 0.08, 0)
	m.damping_min = 0.1
	m.damping_max = 0.2
	m.scale_min = 0.8 * size
	m.scale_max = 1.3 * size
	m.scale_curve = _curve([Vector2(0, 0.4), Vector2(0.5, 1.2), Vector2(1, 2.4)], 2.5)
	m.angular_velocity_min = -15.0
	m.angular_velocity_max = 15.0
	m.color_ramp = _ramp(
		[
			Color(0.16, 0.15, 0.14, 0.0),
			Color(0.2, 0.19, 0.18, 0.75),
			Color(0.36, 0.35, 0.34, 0.45),
			Color(0.5, 0.5, 0.49, 0.0),
		],
		[0.0, 0.12, 0.6, 1.0]
	)
	m.turbulence_enabled = true
	m.turbulence_noise_strength = 1.5
	m.turbulence_noise_scale = 3.0
	m.turbulence_influence_min = 0.03
	m.turbulence_influence_max = 0.08
	p.process_material = m
	return p


## Открытый огонь: языки пламени, искры, мерцающий свет и дым над ними.
static func fire(size := 1.0) -> Node3D:
	var root := Node3D.new()
	var flames := _particles(
		int(34 * clampf(size, 0.5, 2.0)),
		0.9,
		Vector2(1.3, 1.9),
		"fire",
		AABB(Vector3(-3, -1, -3) * size, Vector3(6, 8, 6) * size)
	)
	flames.preprocess = 1.0
	var m := _process_material(Vector3.UP, 6.0)
	m.angle_min = -12.0
	m.angle_max = 12.0
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	m.emission_box_extents = Vector3(0.8, 0.2, 1.1) * size
	m.initial_velocity_min = 0.8
	m.initial_velocity_max = 1.8
	m.gravity = Vector3(0, 2.2, 0) + WIND * 0.4
	m.scale_min = 1.1 * size
	m.scale_max = 1.8 * size
	m.scale_curve = _curve([Vector2(0, 0.55), Vector2(0.25, 1.0), Vector2(1, 0.35)])
	m.color_ramp = _ramp(
		[
			Color(1.0, 0.85, 0.6, 0.0),
			Color(1.0, 0.8, 0.55, 1.0),
			Color(1.0, 0.45, 0.15, 0.75),
			Color(0.55, 0.12, 0.03, 0.0),
		],
		[0.0, 0.1, 0.55, 1.0]
	)
	flames.process_material = m
	root.add_child(flames)

	var sparks := _particles(
		int(14 * size),
		2.4,
		Vector2(0.07, 0.07),
		"spark",
		AABB(Vector3(-6, -1, -6), Vector3(12, 16, 12))
	)
	sparks.preprocess = 2.0
	var s := _process_material(Vector3.UP, 25.0)
	s.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	s.emission_box_extents = Vector3(0.6, 0.3, 0.6) * size
	s.initial_velocity_min = 2.0
	s.initial_velocity_max = 4.5
	s.gravity = Vector3(0, 0.6, 0) + WIND * 0.6
	s.damping_min = 0.5
	s.damping_max = 1.0
	s.scale_min = 0.6
	s.scale_max = 1.4
	s.color_ramp = _ramp(
		[Color(1, 0.8, 0.4, 1), Color(1, 0.45, 0.1, 1), Color(0.6, 0.15, 0.05, 0)], [0.0, 0.5, 1.0]
	)
	s.turbulence_enabled = true
	s.turbulence_noise_strength = 3.0
	s.turbulence_noise_scale = 2.0
	s.turbulence_influence_min = 0.2
	s.turbulence_influence_max = 0.4
	sparks.process_material = s
	root.add_child(sparks)

	var light := Flicker.new()
	light.base_energy = 3.5 * size
	light.light_color = Color(1.0, 0.55, 0.25)
	light.omni_range = 11.0 * size
	light.position.y = 0.8 * size
	root.add_child(light)

	var smoke := smoke_column(0.7 * size)
	smoke.position.y = 1.6 * size
	root.add_child(smoke)
	return root


## Свет, который мерцает, как от огня.
class Flicker:
	extends OmniLight3D
	var base_energy := 2.0
	var _t := randf() * 100.0

	func _ready() -> void:
		shadow_enabled = false
		light_energy = base_energy

	func _process(delta: float) -> void:
		_t += delta
		var n := sin(_t * 9.1) * 0.5 + sin(_t * 23.7 + 1.3) * 0.3 + sin(_t * 3.3) * 0.2
		light_energy = base_energy * (0.8 + 0.2 * n)


# --- разрывы ------------------------------------------------------------


## Разрыв снаряда или мины в точке at: вспышка, огненный шар, дым, пыль и
## осколки. Через несколько секунд всё убирается само.
static func explosion(root: Node, at: Vector3, size := 1.0) -> void:
	var node := Node3D.new()
	root.add_child(node)
	node.global_position = at

	var light := OmniLight3D.new()
	light.light_color = Color(1.0, 0.72, 0.42)
	light.light_energy = 14.0 * size
	light.omni_range = 28.0 * size
	light.position.y = 2.0
	node.add_child(light)
	var fade := node.create_tween()
	fade.tween_property(light, "light_energy", 0.0, 0.45).set_ease(Tween.EASE_OUT)

	var ball := _particles(
		int(26 * size),
		0.8,
		Vector2(2.2, 2.6),
		"fire",
		AABB(Vector3(-12, -2, -12), Vector3(24, 20, 24))
	)
	ball.one_shot = true
	ball.explosiveness = 0.95
	var b := _process_material(Vector3.UP, 75.0)
	b.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	b.emission_sphere_radius = 0.6 * size
	b.initial_velocity_min = 4.0 * size
	b.initial_velocity_max = 9.0 * size
	b.damping_min = 8.0
	b.damping_max = 12.0
	b.gravity = Vector3(0, 2.0, 0)
	b.scale_min = 1.6 * size
	b.scale_max = 2.8 * size
	b.scale_curve = _curve([Vector2(0, 0.4), Vector2(0.2, 1.0), Vector2(1, 1.3)], 1.5)
	b.color_ramp = _ramp(
		[Color(1, 0.95, 0.8, 1), Color(1, 0.6, 0.2, 0.9), Color(0.5, 0.15, 0.04, 0)],
		[0.0, 0.35, 1.0]
	)
	ball.process_material = b
	node.add_child(ball)

	var smoke := _particles(
		int(22 * size),
		7.0,
		Vector2(2.4, 2.4),
		"smoke",
		AABB(Vector3(-20, -2, -20), Vector3(40, 40, 40))
	)
	smoke.one_shot = true
	smoke.explosiveness = 0.85
	var s := _process_material(Vector3.UP, 60.0)
	s.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_SPHERE
	s.emission_sphere_radius = 1.0 * size
	s.initial_velocity_min = 2.0 * size
	s.initial_velocity_max = 6.0 * size
	s.damping_min = 1.5
	s.damping_max = 2.5
	s.gravity = Vector3(0, 0.5, 0) + WIND * 0.3
	s.scale_min = 2.0 * size
	s.scale_max = 3.4 * size
	s.scale_curve = _curve([Vector2(0, 0.5), Vector2(0.3, 1.2), Vector2(1, 2.4)], 2.5)
	s.angular_velocity_min = -20.0
	s.angular_velocity_max = 20.0
	s.color_ramp = _ramp(
		[
			Color(0.12, 0.11, 0.1, 0.0),
			Color(0.16, 0.15, 0.14, 0.9),
			Color(0.38, 0.36, 0.33, 0.5),
			Color(0.5, 0.48, 0.45, 0.0),
		],
		[0.0, 0.05, 0.5, 1.0]
	)
	smoke.process_material = s
	node.add_child(smoke)

	# пыль кольцом по земле
	var dust := _particles(
		int(16 * size),
		3.5,
		Vector2(2.0, 2.0),
		"smoke",
		AABB(Vector3(-20, -2, -20), Vector3(40, 12, 40))
	)
	dust.one_shot = true
	dust.explosiveness = 1.0
	var d := _process_material(Vector3(1, 0.15, 0), 180.0)
	d.flatness = 0.9
	d.initial_velocity_min = 6.0 * size
	d.initial_velocity_max = 10.0 * size
	d.damping_min = 5.0
	d.damping_max = 7.0
	d.scale_min = 1.5 * size
	d.scale_max = 2.5 * size
	d.scale_curve = _curve([Vector2(0, 0.6), Vector2(1, 1.8)], 2.0)
	d.color_ramp = _ramp(
		[Color(0.45, 0.4, 0.33, 0.0), Color(0.45, 0.4, 0.33, 0.7), Color(0.55, 0.5, 0.44, 0.0)],
		[0.0, 0.08, 1.0]
	)
	dust.process_material = d
	node.add_child(dust)

	# осколки и комья земли
	var debris := GPUParticles3D.new()
	debris.amount = int(30 * size)
	debris.lifetime = 2.2
	debris.one_shot = true
	debris.explosiveness = 1.0
	debris.fixed_fps = 30
	debris.visibility_aabb = AABB(Vector3(-25, -2, -25), Vector3(50, 30, 50))
	var chunk := BoxMesh.new()
	chunk.size = Vector3(0.12, 0.08, 0.1)
	chunk.material = particle_material("debris")
	debris.draw_pass_1 = chunk
	var c := ParticleProcessMaterial.new()
	c.direction = Vector3.UP
	c.spread = 55.0
	c.initial_velocity_min = 6.0 * size
	c.initial_velocity_max = 15.0 * size
	c.gravity = Vector3(0, -9.8, 0)
	c.angular_velocity_min = -400.0
	c.angular_velocity_max = 400.0
	c.scale_min = 0.6
	c.scale_max = 2.0
	c.collision_mode = ParticleProcessMaterial.COLLISION_RIGID
	c.collision_friction = 0.6
	c.collision_bounce = 0.2
	debris.process_material = c
	debris.collision_base_size = 0.05
	node.add_child(debris)

	for p: GPUParticles3D in [ball, smoke, dust, debris]:
		p.emitting = true
	root.get_tree().create_timer(9.0, false).timeout.connect(node.queue_free)


# --- трассеры и ракеты --------------------------------------------------


## Трассер: светящийся штрих летит от from к to со скоростью speed (м/с).
static func tracer(
	root: Node, from: Vector3, to: Vector3, color := Color(1.0, 0.5, 0.2), speed := 420.0
) -> void:
	if from.distance_to(to) < 1.0:
		return
	var t := Tracer.new()
	var mesh := BoxMesh.new()
	mesh.size = Vector3(0.045, 0.045, 1.0)
	mesh.material = glow_material(color, 14.0)
	t.mesh = mesh
	t.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	t.from = from
	t.to = to
	t.speed = speed
	root.add_child(t)


class Tracer:
	extends MeshInstance3D
	var from := Vector3.ZERO
	var to := Vector3.FORWARD
	var speed := 420.0
	var _travel := 0.0

	func _ready() -> void:
		var dir := (to - from).normalized()
		var up := Vector3.RIGHT if absf(dir.y) > 0.98 else Vector3.UP
		global_transform = Transform3D(Basis.looking_at(dir, up), from)
		scale = Vector3(1, 1, 0.01)

	func _process(delta: float) -> void:
		var length := from.distance_to(to)
		_travel += speed * delta
		var head := minf(_travel, length)
		var tail := clampf(_travel - 4.0, 0.0, length)
		if tail >= length:
			queue_free()
			return
		var dir := (to - from) / length
		global_position = from + dir * (head + tail) * 0.5
		scale = Vector3(1, 1, maxf(head - tail, 0.01))


## Осветительная ракета: висит в небе, медленно опускается, светит и дымит.
static func flare(root: Node, at: Vector3) -> void:
	var f := Flare.new()
	root.add_child(f)
	f.global_position = at


class Flare:
	extends Node3D
	const LIFE := 26.0
	var _age := 0.0
	var _light: OmniLight3D

	func _ready() -> void:
		_light = OmniLight3D.new()
		_light.light_color = Color(1.0, 0.9, 0.72)
		_light.omni_range = 80.0
		_light.omni_attenuation = 0.8
		add_child(_light)
		var core := MeshInstance3D.new()
		var ball := SphereMesh.new()
		ball.radius = 0.25
		ball.height = 0.5
		ball.material = BattleFx.glow_material(Color(1.0, 0.92, 0.75), 40.0)
		core.mesh = ball
		core.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(core)
		var trail := BattleFx.smolder(0.6)
		trail.preprocess = 0.0
		trail.position.y = 0.4
		add_child(trail)

	func _process(delta: float) -> void:
		_age += delta
		position += Vector3(0.9, -1.4, 0.3) * delta
		var fade := clampf((LIFE - _age) / 4.0, 0.0, 1.0) * clampf(_age / 0.6, 0.0, 1.0)
		_light.light_energy = (7.0 + sin(_age * 17.0) * 0.8 + sin(_age * 5.0) * 0.5) * fade
		if _age > LIFE:
			queue_free()


# --- воздух -------------------------------------------------------------


## Пепел и хлопья сажи, медленно летящие в воздухе вокруг камеры.
static func ash() -> GPUParticles3D:
	var p := _particles(
		220, 9.0, Vector2(0.05, 0.05), "smoke", AABB(Vector3(-40, -20, -40), Vector3(80, 40, 80))
	)
	p.preprocess = 9.0
	var m := _process_material(Vector3.DOWN, 30.0)
	m.emission_shape = ParticleProcessMaterial.EMISSION_SHAPE_BOX
	m.emission_box_extents = Vector3(22, 9, 22)
	m.initial_velocity_min = 0.2
	m.initial_velocity_max = 0.6
	m.gravity = Vector3(0, -0.25, 0) + WIND * 0.5
	m.damping_min = 0.3
	m.damping_max = 0.6
	m.scale_min = 0.6
	m.scale_max = 1.6
	m.angular_velocity_min = -90.0
	m.angular_velocity_max = 90.0
	m.color_ramp = _ramp(
		[Color(0.18, 0.17, 0.16, 0), Color(0.22, 0.21, 0.2, 0.9), Color(0.3, 0.29, 0.28, 0)],
		[0.0, 0.15, 1.0]
	)
	m.turbulence_enabled = true
	m.turbulence_noise_strength = 1.0
	m.turbulence_noise_scale = 2.5
	m.turbulence_influence_min = 0.1
	m.turbulence_influence_max = 0.25
	p.process_material = m
	return p
