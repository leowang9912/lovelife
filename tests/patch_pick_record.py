# -*- coding: utf-8 -*-
"""向 ui.js 注入 pickRecord 多条记录选择器（先选后编辑）"""
import io

P = r"D:\lovelife\app\js\ui.js"
s = io.open(P, encoding="utf-8").read()

HELPER = (
    "  /* ---------- 日历多条记录选择器（先选后编辑） ---------- */\n"
    "  function pickRecord(title, rows, cb) {\n"
    "    modal({\n"
    "      title: title, width: 520,\n"
    "      bodyHTML: rows.map(function (r) {\n"
    "        return '<div class=\"pick-rec-row\" data-pick=\"' + r.id + '\">' +\n"
    "          (r.thumbPath ? '<img data-path=\"' + U.escapeHtml(r.thumbPath) + '\" alt=\"\"/>'\n"
    "            : '<div class=\"pick-rec-thumb-empty\">' + U.escapeHtml(r.icon || '📄') + '</div>') +\n"
    "          '<div class=\"flex1\"><div>' + r.text + '</div>' +\n"
    "          (r.sub ? '<div class=\"muted small\">' + r.sub + '</div>' : '') + '</div>' +\n"
    "          '<span class=\"muted\">›</span></div>';\n"
    "      }).join(''),\n"
    "      footerHTML: '<button class=\"btn btn-ghost\" data-x=\"c\">取消</button>' +\n"
    "        '<button class=\"btn btn-primary\" data-x=\"n\">＋ 新增一条</button>',\n"
    "      onMount: function (wrap, close) {\n"
    "        wrap.querySelectorAll('img[data-path]').forEach(async function (img) {\n"
    "          const url = await window.Storage.getImageURL(img.getAttribute('data-path'));\n"
    "          if (url) img.src = url;\n"
    "        });\n"
    "        wrap.querySelectorAll('[data-pick]').forEach(function (row) {\n"
    "          row.addEventListener('click', function () {\n"
    "            close();\n"
    "            cb(row.getAttribute('data-pick'));\n"
    "          });\n"
    "        });\n"
    "        wrap.querySelector('[data-x=c]').addEventListener('click', close);\n"
    "        wrap.querySelector('[data-x=n]').addEventListener('click', function () {\n"
    "          close();\n"
    "          cb(null);\n"
    "        });\n"
    "      }\n"
    "    });\n"
    "  }\n"
    "\n"
)

ANCHOR = "  return {\n    toast: toast, modal: modal, confirmDialog: confirmDialog,"
assert ANCHOR in s, "anchor not found"
assert "pickRecord" not in s, "already patched"
s = s.replace(ANCHOR, HELPER + ANCHOR)
s = s.replace(
    "itemCard: itemCard, catsFor: catsFor, kindOfCategory: kindOfCategory,",
    "itemCard: itemCard, catsFor: catsFor, kindOfCategory: kindOfCategory, pickRecord: pickRecord,",
)
io.open(P, "w", encoding="utf-8", newline="").write(s)
print("OK pickRecord added to ui.js")
