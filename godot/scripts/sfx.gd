class_name Sfx
extends RefCounted
## Звуки боя (assets/sounds/*.wav — их синтезирует scripts/make-sounds.mjs):
## звук в точке мира и «в ушах» игрока.
##
## Звуки в точке мира идут не через AudioStreamPlayer3D. Такой плеер на каждом
## шаге микшера заменяет громкости своего звука по каналам, а старые Godot
## (4.3, и в 4.4–4.5 так же) освобождает в главном потоке через кадр, не
## дожидаясь звукового потока: если тот в этот миг их ещё читает, игра падает.
## При сотнях выстрелов в секунду это изредка случалось. Поэтому громкость (по
## расстоянию до камеры) и сторону (слева или справа от камеры) звука считаем
## один раз — когда он начинается — и играем его через общий полифонический
## плеер на шине с нужной панорамой; дальние — на шине с фильтром, глуше.
## У этих плееров громкость не меняется, и освобождать нечего.

const DIR := "res://assets/sounds/"
## Панорама шин, слева направо.
const PANS := [-0.9, -0.45, 0.0, 0.45, 0.9]
## Дальше этого звук глуше: шина с фильтром высоких частот.
const FAR := 35.0
## Сколько звуков разом на одной шине.
const VOICES := 24
const MAX_DB := 6.0

static var _cache := {}
## Плееры шин: сначала ближние (по PANS), потом дальние.
static var _players: Array[AudioStreamPlayer] = []


static func stream(sound: String) -> AudioStream:
	if not _cache.has(sound):
		_cache[sound] = load(DIR + sound + ".wav")
	return _cache[sound]


## Создать шины с панорамой и их плееры (один раз, из автозагрузки Game).
static func setup(owner: Node) -> void:
	for far in [false, true]:
		for k in PANS.size():
			var bus := ("SfxFar%d" if far else "Sfx%d") % k
			if AudioServer.get_bus_index(bus) < 0:
				AudioServer.add_bus()
				var index := AudioServer.bus_count - 1
				AudioServer.set_bus_name(index, bus)
				AudioServer.set_bus_send(index, &"Master")
				var panner := AudioEffectPanner.new()
				panner.pan = PANS[k]
				AudioServer.add_bus_effect(index, panner)
				if far:
					var filter := AudioEffectLowPassFilter.new()
					filter.cutoff_hz = 2400.0
					AudioServer.add_bus_effect(index, filter)
			var polyphonic := AudioStreamPolyphonic.new()
			polyphonic.polyphony = VOICES
			var player := AudioStreamPlayer.new()
			player.stream = polyphonic
			player.bus = bus
			owner.add_child(player)
			player.play()
			_players.append(player)


## Заглушить всё, что звучит в мире (при смене сцены).
static func silence() -> void:
	for player in _players:
		var playback := player.get_stream_playback() as AudioStreamPlaybackPolyphonic
		for id: int in player.get_meta(&"voices", []):
			playback.stop_stream(id)
		player.set_meta(&"voices", [])


## Звук в точке мира. Громкость — как у 3D-звука: unit_size — на каком
## расстоянии от камеры ещё в полную силу, дальше тише (вдвое дальше — на
## 6 дБ). Сторона и громкость считаются один раз, в начале звука.
static func play_at(
	parent: Node, sound: String, at: Vector3, volume_db := 0.0, unit_size := 10.0
) -> void:
	if _players.is_empty():
		return
	var camera := parent.get_viewport().get_camera_3d()
	var ear := camera.global_position if camera else at
	var distance := ear.distance_to(at)
	var db := minf(volume_db + linear_to_db(unit_size / maxf(distance, 0.1)), MAX_DB)
	if db < -50.0:
		return
	var side := 0.0
	if camera and distance > 0.5:
		side = (at - ear).normalized().dot(camera.global_transform.basis.x)
	var k := clampi(roundi((side + 1.0) * 2.0), 0, PANS.size() - 1)
	var player := _players[k + (PANS.size() if distance > FAR else 0)]
	_voice(player, stream(sound), db, randf_range(0.94, 1.06))


## Свободный голос плеера шины. Голос освобождается только к следующему шагу
## микшера, поэтому, когда свободен последний, самый старый звук глушится
## заранее — к следующему звуку место будет.
static func _voice(player: AudioStreamPlayer, sound: AudioStream, db: float, pitch: float) -> void:
	var playback := player.get_stream_playback() as AudioStreamPlaybackPolyphonic
	if not playback:
		return
	var voices: Array = player.get_meta(&"voices", [])
	voices = voices.filter(func(id: int) -> bool: return playback.is_stream_playing(id))
	if voices.size() >= VOICES - 1:
		playback.stop_stream(voices.pop_front())
	var id := playback.play_stream(sound, 0.0, db, pitch)
	if id != AudioStreamPlaybackPolyphonic.INVALID_ID:
		voices.append(id)
	player.set_meta(&"voices", voices)


## Разовый звук без места — «в ушах» (оружие игрока, механика).
static func play(parent: Node, sound: String, volume_db := 0.0, pitch := 1.0) -> AudioStreamPlayer:
	var player := AudioStreamPlayer.new()
	player.stream = stream(sound)
	player.volume_db = volume_db
	player.pitch_scale = pitch
	parent.add_child(player)
	player.finished.connect(player.queue_free)
	player.play()
	return player
