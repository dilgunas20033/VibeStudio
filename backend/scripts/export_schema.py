"""Write the shared JSON Schemas (project document, generation request and plan) to shared/.

The frontend generates TypeScript types from those files (npm run gen:types), so
backend and frontend share one contract. Run after changing the Pydantic models:

    python scripts/export_schema.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from app.generation.params import GenerationPlan, GenerationRequest  # noqa: E402
from app.schemas.project import ProjectDocument  # noqa: E402

SHARED = ROOT / "shared"
# file name -> (model, schema mode). Requests use "validation" so optional inputs stay
# optional in TypeScript; responses use "serialization" so defaulted fields are required.
SCHEMAS = {
    "project.schema.json": (ProjectDocument, "serialization"),
    "generation-request.schema.json": (GenerationRequest, "validation"),
    "generation-plan.schema.json": (GenerationPlan, "serialization"),
}


def _strip_field_titles(node: object) -> None:
    """Drop Pydantic's auto-generated per-field titles; they produce noisy TS aliases."""
    if isinstance(node, dict):
        for prop in node.get("properties", {}).values():
            if isinstance(prop, dict):
                prop.pop("title", None)
        for value in node.values():
            _strip_field_titles(value)
    elif isinstance(node, list):
        for item in node:
            _strip_field_titles(item)


def render(name: str) -> str:
    model, mode = SCHEMAS[name]
    schema = model.model_json_schema(by_alias=True, mode=mode)
    _strip_field_titles(schema)
    return json.dumps(schema, indent=2, sort_keys=True) + "\n"


if __name__ == "__main__":
    SHARED.mkdir(exist_ok=True)
    for name in SCHEMAS:
        (SHARED / name).write_text(render(name), encoding="utf-8")
        print(f"wrote shared/{name}")
