"""Single source of truth for the four ISO 27001 certification RFQ packets.

RBR-771 fixed the sender identity, the appointed title, and the phone-omission
wording. RBR-780 restored the build/verify scripts that had gone missing from
disk; this module holds the constants all three of them share so that a change
to (say) the sender contact cannot land in the cover messages without also
landing in the verifier.

Nothing here reaches out to the network or to the Paperclip API. It is pure
data plus the small helpers that operate on it.
"""

from __future__ import annotations

import os
from pathlib import Path

# --------------------------------------------------------------------------
# Layout
# --------------------------------------------------------------------------

# scripts/rbr771/packet_spec.py -> scripts/rbr771 -> scripts -> <workspace>
WORKSPACE_ROOT = Path(__file__).resolve().parents[2]

# data/ is gitignored, so the packets live only on the machine that built them.
# The scripts are tracked; the artifacts they read and write are not.
DEFAULT_PACKET_ROOT = WORKSPACE_ROOT / "data" / "rbr-771-final-packets"


def packet_root() -> Path:
    """Resolve the packet directory, allowing an env override for testing."""
    override = os.environ.get("RBR771_PACKET_ROOT")
    return Path(override).resolve() if override else DEFAULT_PACKET_ROOT


# --------------------------------------------------------------------------
# Sender identity (RBR-771 decision)
# --------------------------------------------------------------------------

SENDER_EMAIL = "ben.hamilton@aira.io"

# A Clause 5.3 appointment, not an asserted corporate office. Record:
# Aira-ISO27001/docs/isms/clause-5.3-management-representative-appointment.md
SENDER_TITLE = "Ben Hamilton, Management Representative, ISMS"

SENDER_ORG = "Aira (Rambur Inc.)"

# Must appear verbatim in every outbound artifact. RBR-771 AC3.
PHONE_WORDING = (
    "Aira is a remote-first organisation; email is our preferred and fastest "
    "contact channel. A phone number can be provided on request for scheduling."
)

# The title RBR-766 shipped before the Clause 5.3 appointment existed. If this
# string reappears anywhere the packets have regressed.
STALE_TITLE_PATTERN = r"Ben Hamilton,\s*CISO"


# --------------------------------------------------------------------------
# Guards. These are the whole point of the RBR-771 build step: they must fail
# loudly rather than let a bad artifact reach a certification body.
# --------------------------------------------------------------------------

# Web contact forms cap the message field. RBR-766 shipped A-LIGN at 1278 and
# Schellman at 1328 characters against this ceiling because it inserted the
# phone wording without re-measuring.
COVER_CHAR_CEILING = 1200

# pdftotext defaults to Latin-1, which mangles every em-dash in the text layer
# and leaves a file that will not decode as UTF-8. Always pass -enc UTF-8.
PDFTOTEXT_ENCODING = "UTF-8"

# Internal references that must never reach an external recipient. Recovered
# from the RBR-766 dispatch-readiness evidence record
# (data/evidence/rbr-766-dispatch-readiness-20260805T201501Z.json).
LEAK_PATTERNS = [
    r"aad16410",
    r"RBR-[0-9]",
    r"paperclip",
    r"prepared by",
    r"never sent",
    r"blocked on human",
]

# An unresolved template token, e.g. {{SENDER_TITLE}}.
TOKEN_PATTERN = r"\{\{[^}]*\}\}"


# --------------------------------------------------------------------------
# The four certification bodies
# --------------------------------------------------------------------------

# `slug` is the directory name under the packet root.
# `greeting_name` and `interest` are the only two things that vary between the
# four cover messages; everything else is shared prose.
CERTIFICATION_BODIES = [
    {
        "slug": "align",
        "name": "A-LIGN",
        "greeting_name": "A-LIGN",
        "contact_url": "https://a-lign.com/contact-iso-27001",
        "phone": "888-702-5446",
        "interest": (
            "We are interested in A-LIGN based on your ANAB and UKAS dual "
            "accreditation and the A-SCEND evidence management platform. We "
            "would like a written proposal covering scope, pricing, timeline, "
            "and auditor team."
        ),
    },
    {
        "slug": "schellman",
        "name": "Schellman",
        "greeting_name": "Schellman",
        "contact_url": "https://schellman.com/contact-us",
        "phone": "866-254-0000",
        "interest": (
            "We are interested in Schellman based on your SaaS and cloud "
            "technology audit expertise and your position as the first "
            "ANAB-accredited ISO/IEC 42001 certification body. We would like a "
            "written proposal covering scope, pricing, timeline, and auditor "
            "team."
        ),
    },
    {
        "slug": "barr",
        "name": "BARR Advisory",
        "greeting_name": "BARR Advisory",
        "contact_url": "https://barradvisory.com/contact",
        "phone": "913-579-8314",
        "interest": (
            "We are interested in BARR based on your growth-stage client "
            "focus, fixed-rate pricing, and ANAB accreditation for ISO/IEC "
            "27001, ISO/IEC 27701, and ISO/IEC 42001. We would like a written "
            "proposal covering scope, pricing, timeline, and auditor team."
        ),
    },
    {
        "slug": "ispartners",
        "name": "IS Partners",
        "greeting_name": "IS Partners",
        "contact_url": "https://ispartnersllc.com/contact-us",
        "phone": "610-551-4929",
        "interest": (
            "We are interested in IS Partners based on your recently granted "
            "ANAB accreditation for ISO/IEC 27001:2022 and your combined "
            "advisory-plus-certification service model. We would like a "
            "written proposal covering scope, pricing, timeline, and auditor "
            "team."
        ),
    },
]

CB_SLUGS = [cb["slug"] for cb in CERTIFICATION_BODIES]


def get_cb(slug: str) -> dict:
    for cb in CERTIFICATION_BODIES:
        if cb["slug"] == slug:
            return cb
    raise KeyError(f"unknown certification body slug: {slug!r}")


# --------------------------------------------------------------------------
# Cover message template
# --------------------------------------------------------------------------

# Deliberately plain text. Markdown does not survive a web contact form, which
# is why RBR-758 built these in the first place. Note the ASCII hyphens: the
# cover messages stay pure ASCII so that a form with a narrow charset cannot
# mangle them. The PDFs and full-text bodies keep their typographic dashes.
COVER_TEMPLATE = """\
Hello {greeting_name} team,

Aira (a Rambur Inc. company) is seeking ANAB-accredited ISO/IEC 27001:2022 \
certification for our Information Security Management System. This would be \
our first certification.

About us: remote-first SaaS, ~30-50 employees and contractors in scope, no \
office. Hosted on Google Cloud Platform, with AWS supplementary. Our ISMS also \
covers an internal AI agent toolchain (Google Gemini, OpenRouter) used for \
security, compliance, and engineering work.

{interest}

Target dates: Stage 1 audit October 6-24, 2026; Stage 2 audit November 2026. \
We would appreciate your proposal by August 12, 2026.

Please reply so we can send the full RFQ with scope and evaluation criteria.

Email: {sender_email}

{phone_wording}

Thank you,
{sender_title}
{sender_org}
"""


def render_cover_message(cb: dict) -> str:
    """Render one CB's cover message. Pure function of the spec above."""
    return COVER_TEMPLATE.format(
        greeting_name=cb["greeting_name"],
        interest=cb["interest"],
        sender_email=SENDER_EMAIL,
        phone_wording=PHONE_WORDING,
        sender_title=SENDER_TITLE,
        sender_org=SENDER_ORG,
    )


# --------------------------------------------------------------------------
# Per-CB artifact filenames under <packet_root>/<slug>/
# --------------------------------------------------------------------------

COVER_FILE = "cover-message.txt"
PDF_FILE = "rfq.pdf"
PDFTEXT_FILE = "rfq-pdftext.txt"
FULLTEXT_FILE = "rfq-fulltext.txt"
SOURCE_FILE = "rfq-source.md"

# Artifacts that actually go to a certification body. The leak grep and the
# token check run over exactly these; rfq-source.md and rfq-pdftext.txt are
# reference-only and are checked separately.
OUTBOUND_FILES = [COVER_FILE, FULLTEXT_FILE]

# Every text artifact in a packet directory, outbound or reference.
ALL_TEXT_FILES = [COVER_FILE, FULLTEXT_FILE, PDFTEXT_FILE, SOURCE_FILE]
