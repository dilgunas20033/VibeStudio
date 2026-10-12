"""Text-to-beat generation.

Two independent stages, so either can be replaced without touching the other:

1. Interpretation (interpret.py, llm.py): prompt text -> PromptHints (partial parameters).
   Keyword rules by default; optionally an LLM. Then resolve.py merges user settings,
   hints and genre defaults into a fully specified GenerationPlan.
2. Composition (composer.py): GenerationPlan -> ProjectDocument with editable tracks,
   patterns, clips and sections. This is a seeded, rule-based procedural composer,
   not a neural model, and it is labeled as such everywhere it surfaces.
"""
