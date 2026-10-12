"""Audio-to-MIDI transcription (Phase 3: monophonic humming and singing).

This is signal processing, not a learned transcription model: pYIN pitch tracking
(librosa), rule-based note segmentation, and simple tempo/key estimation. Results carry
per-note confidence because humming never transcribes perfectly.
"""
