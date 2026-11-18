// Offline build tool. The shipped game only decodes the resulting recording.
import AVFoundation
import AudioToolbox
import Foundation

struct OrchestraTrack: Decodable {
    let name: String
    let program: UInt8
    let pan: Float
    let gainDb: Float
    let percussion: Bool?
    let expression: Bool?
}

struct OrchestraNote: Decodable {
    let track: Int
    let note: UInt8
    let velocity: UInt8
    let cents: Double
    let seconds: Double
    let endSeconds: Double
}

struct OrchestraPlan: Decodable {
    let sampleRate: Double
    let durationSeconds: Double
    let reverbPercent: Float
    let tracks: [OrchestraTrack]
    let notes: [OrchestraNote]
}

struct OrchestraEvent {
    let frame: AVAudioFramePosition
    let track: Int
    let note: UInt8
    let velocity: UInt8
    let bend: UInt16
    let on: Bool
    let expression: UInt8?
}

enum RenderError: Error {
    case invalidArguments
    case invalidPlan
    case offlineSamplerFailed
}

func renderOrchestra(planPath: String, outputPath: String) throws {
    let plan = try JSONDecoder().decode(OrchestraPlan.self, from: Data(contentsOf: URL(fileURLWithPath: planPath)))
    guard plan.sampleRate > 0, plan.durationSeconds > 0, !plan.tracks.isEmpty else {throw RenderError.invalidPlan}
    let format = AVAudioFormat(standardFormatWithSampleRate: plan.sampleRate, channels: 2)!
    let engine = AVAudioEngine()
    let bank = URL(fileURLWithPath: "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls")
    var samplers: [AVAudioUnitSampler] = []
    for track in plan.tracks {
        let sampler = AVAudioUnitSampler()
        let mixer = AVAudioMixerNode()
        engine.attach(sampler)
        engine.attach(mixer)
        let bankMSB = track.percussion == true ? kAUSampler_DefaultPercussionBankMSB : kAUSampler_DefaultMelodicBankMSB
        try sampler.loadSoundBankInstrument(at: bank, program: track.program, bankMSB: UInt8(bankMSB), bankLSB: 0)
        mixer.outputVolume = pow(10, track.gainDb / 20)
        mixer.pan = track.pan
        engine.connect(sampler, to: mixer, format: format)
        engine.connect(mixer, to: engine.mainMixerNode, format: format)
        // Set a known two-semitone pitch-bend range for the recovered AY tuning.
        let channel: UInt8 = track.percussion == true ? 9 : 0
        sampler.sendController(101, withValue: 0, onChannel: channel)
        sampler.sendController(100, withValue: 0, onChannel: channel)
        sampler.sendController(6, withValue: 2, onChannel: channel)
        sampler.sendController(38, withValue: 0, onChannel: channel)
        samplers.append(sampler)
    }
    let reverb = AVAudioUnitReverb()
    engine.attach(reverb)
    reverb.loadFactoryPreset(.largeHall2)
    reverb.wetDryMix = plan.reverbPercent
    engine.connect(engine.mainMixerNode, to: reverb, format: format)
    engine.connect(reverb, to: engine.outputNode, format: format)

    var events: [OrchestraEvent] = []
    for note in plan.notes {
        guard note.track >= 0, note.track < samplers.count, note.seconds >= 0,
            note.endSeconds > note.seconds, note.endSeconds <= plan.durationSeconds else {throw RenderError.invalidPlan}
        let bend = UInt16(max(0, min(16383, Int((8192 + note.cents / 200 * 8192).rounded()))))
        events.append(OrchestraEvent(frame: AVAudioFramePosition((note.seconds * plan.sampleRate).rounded()),
            track: note.track, note: note.note, velocity: note.velocity, bend: bend, on: true, expression: nil))
        events.append(OrchestraEvent(frame: AVAudioFramePosition((note.endSeconds * plan.sampleRate).rounded()),
            track: note.track, note: note.note, velocity: 0, bend: bend, on: false, expression: nil))
        if plan.tracks[note.track].expression == true {
            let duration = note.endSeconds - note.seconds
            let curve: [(Double, UInt8)] = duration >= 0.5 ?
                [(0, 80), (0.25, 106), (0.55, 120), (0.82, 112), (0.95, 90)] : [(0, 127)]
            for (fraction, value) in curve {
                events.append(OrchestraEvent(frame: AVAudioFramePosition(((note.seconds + duration * fraction) * plan.sampleRate).rounded()),
                    track: note.track, note: 0, velocity: 0, bend: 0, on: false, expression: value))
            }
        }
    }
    events.sort {
        if $0.frame != $1.frame {return $0.frame < $1.frame}
        let leftOrder = $0.expression != nil ? 1 : ($0.on ? 2 : 0)
        let rightOrder = $1.expression != nil ? 1 : ($1.on ? 2 : 0)
        if leftOrder != rightOrder {return leftOrder < rightOrder}
        if $0.track != $1.track {return $0.track < $1.track}
        return $0.note < $1.note
    }
    try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: 1024)
    try engine.start()
    var file: AVAudioFile? = try AVAudioFile(forWriting: URL(fileURLWithPath: outputPath), settings: [
        AVFormatIDKey: kAudioFormatLinearPCM,
        AVSampleRateKey: plan.sampleRate,
        AVNumberOfChannelsKey: 2,
        AVLinearPCMBitDepthKey: 32,
        AVLinearPCMIsFloatKey: true,
        AVLinearPCMIsBigEndianKey: false,
    ], commonFormat: .pcmFormatFloat32, interleaved: false)
    let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: engine.manualRenderingMaximumFrameCount)!
    let end = AVAudioFramePosition((plan.durationSeconds * plan.sampleRate).rounded())
    var index = 0
    var retries = 0
    while engine.manualRenderingSampleTime < end {
        let position = engine.manualRenderingSampleTime
        while index < events.count && events[index].frame <= position {
            let event = events[index]
            let channel: UInt8 = plan.tracks[event.track].percussion == true ? 9 : 0
            if let expression = event.expression {
                samplers[event.track].sendController(11, withValue: expression, onChannel: channel)
            } else if event.on {
                samplers[event.track].sendPitchBend(event.bend, onChannel: channel)
                samplers[event.track].startNote(event.note, withVelocity: event.velocity, onChannel: channel)
            } else {
                samplers[event.track].stopNote(event.note, onChannel: channel)
            }
            index += 1
        }
        let next = index < events.count ? events[index].frame : end
        let frames = AVAudioFrameCount(min(AVAudioFramePosition(buffer.frameCapacity), min(end - position, next - position)))
        if frames == 0 {continue}
        switch try engine.renderOffline(frames, to: buffer) {
        case .success:
            try file!.write(from: buffer)
            retries = 0
        case .cannotDoInCurrentContext:
            retries += 1
            if retries > 1000 {throw RenderError.offlineSamplerFailed}
        case .insufficientDataFromInputNode, .error:
            throw RenderError.offlineSamplerFailed
        @unknown default:
            throw RenderError.offlineSamplerFailed
        }
    }
    engine.stop()
    // Explicitly release the writer so RIFF sizes are committed before the CLI
    // reads and masters the float recording.
    file = nil
    print("Rendered \(plan.notes.count) sampled orchestral notes, \(plan.durationSeconds)s, stereo \(plan.sampleRate)Hz.")
}

do {
    guard CommandLine.arguments.count == 3 else {throw RenderError.invalidArguments}
    try renderOrchestra(planPath: CommandLine.arguments[1], outputPath: CommandLine.arguments[2])
} catch {
    FileHandle.standardError.write(Data("Offline orchestra: \(error)\n".utf8))
    exit(1)
}
