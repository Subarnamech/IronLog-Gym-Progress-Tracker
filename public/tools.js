/* OmniPorta tool registry.
   Each entry becomes a card on the hub. Add tools with `python3 tools/add_tool.py` (it edits the list
   between the START and END markers) or by hand: create public/<slug>/ and add an entry here.
     slug         folder name and URL: /<slug>/
     name         shown on the card
     description  one sentence, what the tool does
     category     short label shown as a badge
   The icon is read from /<slug>/icons/icon-192.png. */
window.OMNIPORTA_TOOLS = /* TOOLS:START */ [
  {
    "slug": "ironlog",
    "name": "Iron Log",
    "description": "Log sets, track lifting progress and progress photos, and sync your training across devices.",
    "category": "Fitness"
  }
] /* TOOLS:END */;
