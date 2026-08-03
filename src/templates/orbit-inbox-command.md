---
description: Check ORBIT for pending @mention dispatches on this goal, without starting the connect daemon.
---

Run this exact command and show the user its output verbatim (don't
summarize away specific dispatch IDs):

```bash
node __INBOX_SCRIPT_PATH__
```

If it reports pending dispatches, ask the user whether they want you to
look at the referenced task right now, or whether they'd rather run
`orbit-agent connect` so it gets claimed and handled through the normal
flow.
