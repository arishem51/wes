# PHẦN 3 — REQUIREMENTS & MAIN FEATURES

**Người trình bày:** HungPV · **6 slide** (~5 phút) · **Chèn:** thay 2 slide lorem 17–18, ngay trước slide 19
Chữ trên slide viết **tiếng Anh** (khớp slide 9–36). Ghi chú tiếng Việt là note cho người trình bày, không lên slide.

---

## S1 · Scope & boundary
**Headline:** `openTCS is not our competitor. It is our runtime.`

Ba băng ngang:

| Band | Tag | On-slide |
|---|---|---|
| **Business layer** | we wrote it | Request lifecycle · release rules · vehicle assignment · zones · KPI |
| **FMS layer — openTCS** | we replaced its router | Routing lives here. One router for the whole fleet, not one per vehicle. <sub>LaCAM\*</sub> |
| **Kernel machinery** | we kept it | Plant model · resource locking · vehicle adapter · movement execution |

- Seam: `intendedVehicle` — WES pins the vehicle onto the Transport Order; the kernel does not re-choose
- Bottom strip — **Out of scope:** Inventory integration · AI demand forecasting · 3D digital twin

> Note: openTCS vẫn là nơi quyết định đường đi — nhưng thuật toán bên trong là của mình. Băng giữa phải cho thấy cả hai vế đó cùng lúc.

---

## S2 · Why — pain points
**Headline:** `The floor already told us what breaks.`

- **Big stat:** `44%` · *1,874 orders on the peak day. Not one carries a failure reason.*
- Ba số phụ: `309s` create → assign · `780s` end to end · `255s` after assignment alone
- **Congestion & deadlock** — *greedy pushes vehicles into the same narrow aisle; the 255s post-assignment segment is where that friction shows*
- **Dispatch intelligence & safety** — *no physical inventory context. No walk-through: outer items must be cleared before inner ones can be reached*
- Footer: *"Not a hardware problem. An algorithmic one."*

> Note: nối vào KPI slide 11 — cùng bộ số baseline (44.2% · 309s · 780s).

---

## S3 · Feature map — traceability
**Headline:** `Six features. Seven gaps.`

| # | Feature | FE | Gap | Layer |
|---|---|---|---|---|
| 1 | Fleet management | FE-01 | GAP-01 | WES |
| 2 | Pickup / drop-off zones | FE-02 | GAP-02 | WES |
| 3 | Transport requests | FE-03 | GAP-03 | WES |
| 4 | Monitoring & statistics | FE-05 | GAP-05 | WES |
| 5 | Dispatch orchestration | FE-04 | GAP-04 | WES |
| 6 | Routing & deadlock avoidance | FE-08 | GAP-04 | **FMS** |

- Bottom line: *"Plus access control and audit trail — not on stage today."*

> Note: Report 1 có 8 feature; FE-06 và FE-07 không trình bày. Dòng chân là để panel không phải tự đếm ra.

---

## S4 · Configure the world — features 1 + 2
**Headline:** `A vehicle is not always available. A zone is not just a colour.`

- **Fleet** — AGV records · initial position · dispatch enablement · battery thresholds · live state from the kernel (`IDLE / EXECUTING / CHARGING / ERROR / UNAVAILABLE / UNKNOWN`)
  - Callout: *"An ignored vehicle still blocks the aisle."*
- **Zones** — plant model upload · kernel mode · member points · approach location · operational status
  - Callout: *"We manage zones, not topology. Points and paths stay in the Model Editor."*
- Ảnh: AGV list + zone editor trên live map

> Note: hai callout trên là BR-06 và quyết định 20/07 bỏ nhóm UC sửa topology. Sức chứa cột trả hàng là dữ liệu tầng điều phối ăn vào — để dành Q&A.

---

## S5 · Run and watch — features 3 + 4
**Headline:** `Scan is not dispatch.`

- **Flow:** `Scan → Cargo → Transport Request → Transport Order`
  - Callout: *"Cargo and request are two entities. Cancelling the request does not delete the cargo."*
- **Monitoring** — live map over SSE · cargo & task status · KPIs: throughput, congestion hotspots, vehicle utilisation
  - Callout: *"44% failed with no reason recorded. That is what this screen is for."*
- Ảnh dashboard chiếm ~50% slide — slide "wow" của phần này

---

## S6 · Decide — features 5 + 6 → handoff
**Headline:** `Two decisions we did not leave to the kernel.`

- **Dispatch — FE-04:** pickup dependency → eligibility → Dijkstra cost → **Hungarian over the whole batch**
- **Routing — FE-08:** one path per vehicle → **one plan for the whole fleet** in space-time, rolling horizon → **ADG** keeps the order
- **Handoff:** *"Why not just the nearest vehicle? That is the rest of this talk."* → slide 19 `Three Questions`

> ⚠ **Giữ nông.** Slide 21–23 và 31–35 đã làm sâu hai cái này. Nói lại là giết cao trào Phần 4.

---

## Cần chốt
1. Slide 20–35 hardcode counter `02 / 21` … `17 / 21` → chèn 6 slide phải sửa thành `/ 27`
2. Mã LI cho "inventory integration" và "AI demand forecasting" — bảng Limitations rỗng khi sync, phải mở `.docx` gốc
