---
"<img src=x onerror=alert(1)>": "<img src=x onerror=alert(1)>"
chips: ["<img src=x onerror=alert(1)>", "quote \" and '"]
sources:
  - "<img src=x onerror=alert(1)>": "<img src=x onerror=alert(1)>"
  - id: safe
literal: |-
  <img src=x onerror=alert(1)>
    "quoted" 'literal'
folded: >-
  <img src=x onerror=alert(1)>
  "quoted" 'folded'
safe_url: 'https://example.test/a"b''c'
http_url: http://example.test/ok
javascript_url: javascript:alert(1)
data_url: 'data:text/html,<img src=x onerror=alert(1)>'
vbscript_url: vbscript:msgbox(1)
relative_url: //example.test/unsafe
---
# Hostile frontmatter
