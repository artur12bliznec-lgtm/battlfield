class_name HoldMode
extends Node
## Режим «Удержание»: защитники держат точку на площади, пока не выйдет время
## (1, 3 или 5 минут). Каждые 30 секунд из двора ратуши выходят три союзника и
## занимают свободные позиции у точки. Враги идут волнами — сначала с одной
## стороны, потом с двух, и волны растут.
##
## Захват: если на точке враги, а защитников нет, — полоса захвата растёт
## (быстрее, чем больше врагов), и трое ближайших союзников бегут отбивать
## точку; если только защитники — падает; если и те и другие — стоит. Полоса
## дошла до 100 % — поражение. Время вышло — победа.

signal message(text: String, color: Color)
signal finished(victory: bool)

const REINFORCE_EVERY := 30.0
const REINFORCE_SIZE := 3
## Первая волна — когда союзники уже на позициях.
const FIRST_WAVE := 10.0
const WAVE_EVERY := 21.0
const MAX_ALLIES := 10
const MAX_ENEMIES := 16
## % захвата в секунду за каждого врага на точке (считаются до трёх).
const CAPTURE_PER_ENEMY := 3.0
const RECAPTURE := 6.0
const RADIUS := 12.0
const SIDES := {"North": "с севера", "East": "с востока", "South": "с юга", "West": "с запада"}
const RED := Color(1.0, 0.45, 0.35)
const BLUE := Color(0.5, 0.75, 1.0)
const GOLD := Color(0.95, 0.75, 0.32)

var duration := 180.0
var time_left := 180.0
## Насколько враги захватили точку, 0–100 %.
var capture := 0.0
var over := false
var victory := false
var team := "alliance"
var enemy_team := "coalition"
var player: Player
## Куда добавлять ботов (сцена города) и узел Mode с отметками.
var world: Node3D
var marks: Node3D
var center := Vector3.ZERO
var allies: Array[Bot] = []
var enemies: Array[Bot] = []
var enemies_killed := 0
var allies_lost := 0
var player_kills := 0
var allies_arrived := 0
var defenders_on_point := 0
var enemies_on_point := 0

var _time := 0.0
## Первое подкрепление — через полсекунды: навигационная карта успеет собраться.
var _next_reinforce := 0.5
var _next_wave := FIRST_WAVE
var _wave := 0
var _posts: Array[Node3D] = []
var _post_of := {}
var _was_capturing := false
var _next_crack := 0.0


func _ready() -> void:
	time_left = duration
	var point := marks.get_node("CapturePoint") as Node3D
	center = point.global_position
	for group in ["AllyPosts", "DefensePosts"]:
		var node := marks.get_node_or_null(group)
		if node:
			for post: Node3D in node.get_children():
				_posts.append(post)
	message.emit("Удержание: держите площадь %d мин" % roundi(duration / 60.0), GOLD)


func _process(delta: float) -> void:
	if over:
		return
	_time += delta
	time_left = maxf(0.0, duration - _time)
	if _time >= _next_reinforce:
		_next_reinforce += REINFORCE_EVERY
		_reinforce()
	if _time >= _next_wave:
		_next_wave += WAVE_EVERY
		_send_wave()
	_update_capture(delta)
	if time_left <= 0.0:
		_finish(true)


# --- кто с кем воюет ------------------------------------------------------


## Живые защитники: игрок и союзники.
func defenders() -> Array[Node3D]:
	var out: Array[Node3D] = []
	if player and player.alive:
		out.append(player)
	for bot in allies:
		if bot.alive:
			out.append(bot)
	return out


func attackers() -> Array[Node3D]:
	var out: Array[Node3D] = []
	for bot in enemies:
		if bot.alive:
			out.append(bot)
	return out


## Противники бойца who (бота или игрока).
func opponents_of(who: Node) -> Array[Node3D]:
	return defenders() if who.get("hostile") else attackers()


func alive_allies() -> int:
	return allies.filter(func(b: Bot) -> bool: return b.alive).size()


func alive_enemies() -> int:
	return enemies.filter(func(b: Bot) -> bool: return b.alive).size()


# --- подкрепление и волны -------------------------------------------------


func _reinforce() -> void:
	var count := mini(REINFORCE_SIZE, MAX_ALLIES - alive_allies())
	if count <= 0:
		return
	# не прямо в бойце игрока
	var spawns := marks.get_node("DefenderSpawns").get_children().filter(
		func(s: Node3D) -> bool:
			return not player or s.global_position.distance_to(player.global_position) > 2.0
	)
	spawns.shuffle()
	for k in count:
		var spawn := spawns[k % spawns.size()] as Node3D
		var role := "mg" if allies_arrived % 4 == 3 else "rifle"
		var weapon := _weapon(team, role)
		var bot := _spawn(false, role, weapon, spawn.global_transform)
		var post := _free_post()
		if post:
			_post_of[post] = bot
			bot.go(_on_navmesh(post.global_position), -post.global_transform.basis.z)
		else:
			var spot := _capture_spot()
			bot.go(spot, _outward(spot))
		allies_arrived += 1
	message.emit("Подкрепление: +%d %s" % [count, _soldiers(count)], BLUE)


func _send_wave() -> void:
	_wave += 1
	var size := mini(3 + _wave * 3 / 4, 9)
	size = mini(size, MAX_ENEMIES - alive_enemies())
	if size <= 0:
		return
	var sides: Array = SIDES.keys()
	sides.shuffle()
	var used: Array = sides.slice(0, 1 if _wave < 3 else 2)
	var names: Array[String] = []
	for side: String in used:
		names.append(SIDES[side])
	for k in size:
		var side: String = used[k % used.size()]
		var spawns := marks.get_node("AttackerSpawns/" + side).get_children()
		var spawn := spawns[k % spawns.size()] as Node3D
		var role := "rifle"
		if k == 0 and size >= 5:
			role = "mg"
		elif k == 1 and _wave >= 2 and randf() < 0.35:
			role = "sniper"
		var place := spawn.global_transform
		place.origin += Vector3(randf_range(-1.5, 1.5), 0, randf_range(-1.5, 1.5))
		var bot := _spawn(true, role, _weapon(enemy_team, role), place)
		bot.go(_capture_spot(), Vector3.FORWARD)
	message.emit(
		"Волна %d: враги наступают %s" % [_wave, " и ".join(PackedStringArray(names))], RED
	)


func _spawn(hostile: bool, role: String, weapon: Dictionary, place: Transform3D) -> Bot:
	var bot := Bot.new()
	bot.team = enemy_team if hostile else team
	bot.hostile = hostile
	bot.role = role
	bot.weapon = weapon
	bot.mode = self
	bot.transform = place
	bot.goal = place.origin
	world.add_child(bot)
	bot.died.connect(_on_died)
	(enemies if hostile else allies).append(bot)
	return bot


func _weapon(side: String, role: String) -> Dictionary:
	var id: String = Game.TEAMS[side].weapon
	if role == "mg":
		id = "machine_gun"
	elif role == "sniper":
		id = "sniper_rifle"
	for item: Dictionary in Arsenal.ITEMS:
		if item.id == id:
			return item
	return Arsenal.ITEMS[0]


func _free_post() -> Node3D:
	var free: Array[Node3D] = []
	for post in _posts:
		if not _post_of.has(post):
			free.append(post)
	return free.pick_random() if free else null


## Освободить позицию бойца (погиб или ушёл отбивать точку).
func _release_post(bot: Bot) -> void:
	for post: Node3D in _post_of.keys():
		if _post_of[post] == bot:
			_post_of.erase(post)


## Случайное место внутри зоны захвата (на навигационной сетке).
func _capture_spot() -> Vector3:
	var a := randf() * TAU
	var r := randf_range(3.5, 6.2) if randf() < 0.6 else randf_range(9.0, 11.0)
	return _on_navmesh(center + Vector3(cos(a), 0, sin(a)) * r)


## Куда смотреть с места на точке — от памятника наружу.
func _outward(spot: Vector3) -> Vector3:
	var out := Vector3(spot.x - center.x, 0, spot.z - center.z)
	return out.normalized() if out.length() > 0.1 else Vector3.FORWARD


## Враги захватывают точку — трое ближайших союзников бросают позиции и бегут
## отбивать.
func _rally() -> void:
	var away: Array[Bot] = []
	for bot in allies:
		if bot.alive and not _on_point(bot):
			away.append(bot)
	away.sort_custom(
		func(a: Bot, b: Bot) -> bool:
			return (
				a.global_position.distance_squared_to(center)
				< b.global_position.distance_squared_to(center)
			)
	)
	for bot in away.slice(0, 3):
		_release_post(bot)
		var spot := _capture_spot()
		bot.go(spot, _outward(spot))


func _on_navmesh(at: Vector3) -> Vector3:
	var map := world.get_world_3d().navigation_map
	return NavigationServer3D.map_get_closest_point(map, at)


func _soldiers(n: int) -> String:
	return "боец" if n == 1 else ("бойца" if n < 5 else "бойцов")


func _on_died(bot: Bot, killer: Node) -> void:
	if bot.hostile:
		enemies_killed += 1
		if killer != null and killer == player:
			player_kills += 1
	else:
		allies_lost += 1
		_release_post(bot)
	# убитых — из списков, когда исчезнут
	bot.tree_exiting.connect(
		func() -> void:
			allies.erase(bot)
			enemies.erase(bot)
	)


# --- захват ----------------------------------------------------------------


func _on_point(who: Node3D) -> bool:
	var d := Vector2(who.global_position.x - center.x, who.global_position.z - center.z)
	return d.length() <= RADIUS


func _update_capture(delta: float) -> void:
	defenders_on_point = defenders().filter(_on_point).size()
	enemies_on_point = attackers().filter(_on_point).size()
	var capturing := enemies_on_point > 0 and defenders_on_point == 0
	if capturing:
		capture += CAPTURE_PER_ENEMY * mini(enemies_on_point, 3) * delta
	elif defenders_on_point > 0 and enemies_on_point == 0:
		capture -= RECAPTURE * delta
	capture = clampf(capture, 0.0, 100.0)
	if capturing and not _was_capturing:
		message.emit("Враги захватывают точку!", RED)
		_rally()
	elif _was_capturing and not capturing and enemies_on_point > 0:
		message.emit("Бой на точке — захват остановлен", GOLD)
	_was_capturing = capturing
	if capture >= 100.0:
		_finish(false)


func _finish(won: bool) -> void:
	if over:
		return
	over = true
	victory = won
	finished.emit(won)


# --- выстрелы ботов и разрывы ---------------------------------------------


## Выстрел бота: луч из дула по направлению dir. Попал в бойца — урон и
## кровь, в стену — пыль. Пуля прошла рядом с головой игрока — треск.
func fire(shooter: Bot, from: Vector3, dir: Vector3, damage: float, tracer: bool) -> void:
	var to := from + dir * 160.0
	var exclude: Array[RID] = [shooter.get_rid()]
	var query := PhysicsRayQueryParameters3D.create(from, to, 3, exclude)
	var hit := world.get_world_3d().direct_space_state.intersect_ray(query)
	var end: Vector3 = hit.position if hit else to
	if tracer:
		var color := Color(0.35, 1.0, 0.4) if shooter.hostile else Color(1.0, 0.5, 0.2)
		BattleFx.tracer(world, from, end, color, 400.0)
	if hit:
		var target: Object = hit.collider
		if target.has_method("take_damage"):
			if target.get("team") != shooter.team:
				target.take_damage(damage, shooter, end)
				Effects.blood(world, end, -dir)
		elif randf() < 0.35:
			Effects.impact(world, end, hit.normal)
	if shooter.hostile and player and player.alive:
		_crack_near_player(from, end)


func _crack_near_player(from: Vector3, to: Vector3) -> void:
	if _time < _next_crack:
		return
	var head := player.aim_point() + Vector3(0, 0.3, 0)
	var line := to - from
	var t := clampf((head - from).dot(line) / line.length_squared(), 0.0, 1.0)
	var closest := from + line * t
	if closest.distance_to(head) < 2.5 and t < 0.98:
		_next_crack = _time + 0.12
		Sfx.play_at(world, "bullet_crack", closest, 0.0, 6.0)


## Разрыв снаряда в точке at: урон всем рядом (своя артиллерия бьёт по подходам).
func blast(at: Vector3) -> void:
	if over:
		return
	var targets := defenders()
	targets.append_array(attackers())
	for who in targets:
		var d := who.global_position.distance_to(at)
		if d < 9.0:
			who.take_damage(170.0 * pow(1.0 - d / 9.0, 1.5), null, at)
