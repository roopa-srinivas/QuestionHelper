/**
 * Interactive Sample Quiz for testing Question Helper extension
 */

const questions = [
  {
    id: 1,
    stem: "What is the average-case and worst-case time complexity of standard QuickSort with randomized pivot selection?",
    options: [
      "A) Average: O(n log n), Worst: O(n log n)",
      "B) Average: O(n log n), Worst: O(n²)",
      "C) Average: O(n), Worst: O(n log n)",
      "D) Average: O(n²), Worst: O(n²)"
    ]
  },
  {
    id: 2,
    stem: "During aerobic cellular respiration in eukaryotic cells, in which cellular compartment does the citric acid (Krebs) cycle take place?",
    options: [
      "A) Cytosol",
      "B) Mitochondrial matrix",
      "C) Inner mitochondrial membrane (cristae)",
      "D) Endoplasmic reticulum lumen"
    ]
  },
  {
    id: 3,
    stem: "A standard fair six-sided die is rolled twice. What is the exact probability that the sum of the numbers rolled equals 8?",
    options: [
      "A) 1/6",
      "B) 5/36",
      "C) 7/36",
      "D) 1/9"
    ]
  },
  {
    id: 4,
    stem: "Based on the geometric diagram shown below, calculate the hypotenuse c and the sine of angle θ.",
    hasCanvas: true,
    options: [
      "A) c = 10, sin(θ) = 0.6",
      "B) c = 10, sin(θ) = 0.8",
      "C) c = 14, sin(θ) = 0.75",
      "D) c = 12, sin(θ) = 0.5"
    ]
  },
  {
    id: 5,
    stem: "What will the following Python function return when called with mystery(4)?",
    stemHtml: `5. What will the following Python function return when called with <code>mystery(4)</code>?
<pre><code class="language-python">def mystery(n):
    if n <= 1:
        return 1
    return n * mystery(n - 1)</code></pre>`,
    options: [
      "A) 24",
      "B) 16",
      "C) 10",
      "D) 4"
    ]
  },
  {
    id: 6,
    stem: "Evaluate the definite integral: ∫₀¹ (3x² + 2x) dx",
    stemHtml: `6. Evaluate the definite integral:
<span class="katex">
  <span class="katex-mathml">
    <math><semantics><annotation encoding="application/x-tex">\\int_0^1 (3x^2 + 2x)\\,dx</annotation></semantics></math>
  </span>
  <span class="katex-html" aria-hidden="true">∫₀¹ (3x² + 2x) dx</span>
</span>`,
    options: [
      "A) 2",
      "B) 3",
      "C) 1",
      "D) 5/2"
    ]
  },
  {
    id: 7,
    stem: "Given the following truth table, identify the Boolean logic operation:",
    stemHtml: `7. Given the following truth table, identify the Boolean logic operation:
<table style="width: 100%; border-collapse: collapse; margin: 12px 0; border: 1px solid #334155;">
  <thead>
    <tr style="background: rgba(255,255,255,0.06); text-align: left;">
      <th style="padding: 6px 12px; border: 1px solid #334155;">Input A</th>
      <th style="padding: 6px 12px; border: 1px solid #334155;">Input B</th>
      <th style="padding: 6px 12px; border: 1px solid #334155;">Output</th>
    </tr>
  </thead>
  <tbody>
    <tr><td style="padding: 6px 12px; border: 1px solid #334155;">0</td><td style="padding: 6px 12px; border: 1px solid #334155;">0</td><td style="padding: 6px 12px; border: 1px solid #334155;">0</td></tr>
    <tr><td style="padding: 6px 12px; border: 1px solid #334155;">0</td><td style="padding: 6px 12px; border: 1px solid #334155;">1</td><td style="padding: 6px 12px; border: 1px solid #334155;">1</td></tr>
    <tr><td style="padding: 6px 12px; border: 1px solid #334155;">1</td><td style="padding: 6px 12px; border: 1px solid #334155;">0</td><td style="padding: 6px 12px; border: 1px solid #334155;">1</td></tr>
    <tr><td style="padding: 6px 12px; border: 1px solid #334155;">1</td><td style="padding: 6px 12px; border: 1px solid #334155;">1</td><td style="padding: 6px 12px; border: 1px solid #334155;">0</td></tr>
  </tbody>
</table>`,
    options: [
      "A) XOR (Exclusive OR)",
      "B) AND",
      "C) OR",
      "D) XNOR"
    ]
  },
  {
    id: 8,
    stem: "Based on the molecular diagram shown below, identify the molecular geometry and bond angle:",
    stemHtml: `8. Based on the molecular diagram shown below, identify the molecular geometry and bond angle:
<div style="text-align: center; margin: 16px 0;">
  <img src="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='260' height='140' viewBox='0 0 260 140'><rect width='260' height='140' fill='%230b0f19' rx='8'/><circle cx='130' cy='50' r='22' fill='%23ef4444'/><text x='130' y='56' fill='%23ffffff' font-family='sans-serif' font-weight='bold' font-size='16' text-anchor='middle'>O</text><circle cx='60' cy='105' r='16' fill='%2338bdf8'/><text x='60' y='110' fill='%23000' font-family='sans-serif' font-weight='bold' font-size='14' text-anchor='middle'>H</text><circle cx='200' cy='105' r='16' fill='%2338bdf8'/><text x='200' y='110' fill='%23000' font-family='sans-serif' font-weight='bold' font-size='14' text-anchor='middle'>H</text><line x1='114' y1='65' x2='74' y2='95' stroke='%2394a3b8' stroke-width='4'/><line x1='146' y1='65' x2='186' y2='95' stroke='%2394a3b8' stroke-width='4'/><text x='130' y='110' fill='%23f59e0b' font-family='sans-serif' font-size='13' font-weight='bold' text-anchor='middle'>~104.5°</text></svg>" alt="Water molecule H2O diagram with bent geometry and 104.5 degree bond angle" style="max-width: 100%; border-radius: 8px; border: 1px solid #334155;">
</div>`,
    options: [
      "A) Bent (~104.5°)",
      "B) Linear (180°)",
      "C) Trigonal planar (120°)",
      "D) Tetrahedral (109.5°)"
    ]
  },
  {
    id: 9,
    stem: "Consider an ideal gas undergoing adiabatic expansion. What is the relation and final temperature?",
    stemHtml: `<h3>Question 9: Multi-Part Thermodynamics Scenario</h3>
<p>Consider an ideal monatomic gas undergoing a reversible <strong>adiabatic expansion</strong> from initial state $(P_1, V_1, T_1)$ to final volume $V_2 = 2V_1$.</p>
<details style="margin: 10px 0; padding: 8px 12px; background: rgba(255,255,255,0.04); border-radius: 6px; border: 1px solid #334155;">
  <summary style="cursor: pointer; font-weight: 600; color: #38bdf8;">Click to expand System Assumptions & Constants</summary>
  <p style="margin-top: 6px;">Adiabatic condition: $Q = 0$. Heat capacity ratio: $\\gamma = C_p/C_v = 5/3$. Initial temperature: $T_1 = 300\\text{ K}$.</p>
</details>
<p style="margin-top: 10px;"><strong>Part 1:</strong> The equation of state relating pressure and volume is:
  <select style="background: #1e293b; color: #f8fafc; border: 1px solid #334155; padding: 4px 8px; border-radius: 4px;">
    <option value="">Select governing relation...</option>
    <option value="1">PV = constant</option>
    <option value="2">P V^γ = constant</option>
    <option value="3">P / T = constant</option>
  </select>
</p>
<p style="margin-top: 10px;"><strong>Part 2:</strong> When the volume doubles adiabatically ($V_2 = 2V_1$), how does the final temperature $T_2$ compare to the initial temperature $T_1 = 300\\text{ K}$?</p>`,
    options: [
      "A) Less than 300 K (T₂ ≈ 189 K due to work done during expansion)",
      "B) Exactly 300 K (isothermal behavior)",
      "C) Greater than 300 K (compression heating)",
      "D) Cannot be determined without mass"
    ]
  },
  {
    id: 10,
    stem: "Which kinds of code can be tested Repeatably and Independently?",
    stemHtml: `<div class="problem" data-block-type="problem">
  <h3 style="font-size: 1.15rem; font-weight: 700; margin-bottom: 4px;">Q1 Self-Check 8.1: FIRST, TDD, and Red–Green–Refactor</h3>
  <div style="font-size: 0.85rem; color: #94a3b8; margin-bottom: 14px;">1 Point</div>
  <p style="margin-bottom: 12px; font-size: 1rem; line-height: 1.5;">Which kinds of code can be tested Repeatably and Independently?</p>
  <p style="margin-bottom: 12px; line-height: 1.5;">(i) Code that relies on randomness (e.g. shuffling a deck of cards);</p>
  <p style="margin-bottom: 14px; line-height: 1.5;">(ii) Code that relies on time of day (e.g. run backups every Sunday at midnight).</p>
</div>`,
    options: [
      "Both",
      "Only (i)",
      "Only (ii)",
      "Neither"
    ]
  },
  {
    id: 11,
    stem: "PrairieLearn Physics Calculation: Dropped Mass Velocity",
    stemHtml: `<div class="card" style="border: 1px solid #334155; border-radius: 8px; padding: 18px; background: #1e293b;">
  <div class="card-header" style="font-weight: 700; color: #38bdf8; margin-bottom: 12px; border-bottom: 1px solid #334155; padding-bottom: 8px;">
    PrairieLearn Dynamics Homework • Problem 3.2
  </div>
  <pl-question-panel>
    <p style="margin-bottom: 12px; line-height: 1.5; font-size: 1rem;">
      A block of mass $m = 4.00\\text{ kg}$ is dropped from rest from a height $h = 20.0\\text{ m}$ above the ground.
      Take the acceleration due to gravity as $g = 9.80\\text{ m/s}^2$ and neglect air resistance.
    </p>
    <p style="margin-bottom: 12px; line-height: 1.5; font-size: 1rem;">
      Calculate the speed of the block immediately before striking the ground.
    </p>
  </pl-question-panel>
  <div style="margin-top: 14px; padding: 10px; background: #0f172a; border-radius: 6px; border: 1px solid #334155;">
    <pl-number-input answers-name="v_final" label="$v = $" suffix="$\\text{m/s}$" comparison="sigfig" digits="3" placeholder="number">
      <div class="input-group" style="display: flex; align-items: center; gap: 8px;">
        <span style="color: #94a3b8; font-family: monospace; font-size: 15px;">$v =$</span>
        <input type="text" name="v_final" class="form-control" placeholder="number" style="background: #1e293b; border: 1px solid #475569; color: #f8fafc; padding: 8px 12px; border-radius: 6px; width: 140px; font-size: 14px; outline: none;">
        <span style="color: #94a3b8; font-family: monospace; font-size: 14px;">m/s</span>
      </div>
    </pl-number-input>
  </div>
</div>`,
    options: []
  },
  {
    id: 12,
    stem: "PrairieLearn Multi-Part Calculation: Projectile Motion",
    stemHtml: `<div class="question-container">
  <form class="question-form">
    <div class="card mb-4" style="border: 1px solid #334155; border-radius: 8px; padding: 18px; background: #1e293b;">
      <div class="card-header" style="font-weight: 700; color: #38bdf8; margin-bottom: 12px; border-bottom: 1px solid #334155; padding-bottom: 8px;">
        PrairieLearn Multi-Part Homework • Projectile Motion
      </div>
      <pl-question-panel>
        <p style="margin-bottom: 10px; line-height: 1.5; font-size: 1rem;">
          A projectile is launched with initial velocity $v_0 = 25.0\\text{ m/s}$ at an angle $\\theta = 30.0^\\circ$ above the horizontal. Take $g = 9.80\\text{ m/s}^2$.
        </p>
      </pl-question-panel>
      <div style="margin-bottom: 16px; padding: 12px; background: #0f172a; border-radius: 6px; border: 1px solid #334155;">
        <p style="font-size: 0.95rem; margin-bottom: 6px; color: #e2e8f0;">(a) What is the horizontal component of initial velocity, $v_{0x}$?</p>
        <span class="pl-number-input form-inline">
          <span class="pl-number-input-label" style="color: #94a3b8; font-family: monospace; margin-right: 8px;">$v_{0x} = $</span>
          <span class="input-group">
            <input name="_q_submission_v_0x" type="text" class="form-control pl-input-element" placeholder="number" style="background: #1e293b; border: 1px solid #475569; color: #f8fafc; padding: 6px 10px; border-radius: 6px; width: 130px; font-size: 14px;">
            <span class="input-group-append" style="color: #94a3b8; font-family: monospace; margin-left: 6px;">m/s</span>
          </span>
        </span>
      </div>
      <pl-question-panel>
        <p style="margin-bottom: 6px; font-size: 0.95rem; color: #e2e8f0;">(b) What is the vertical component of initial velocity, $v_{0y}$?</p>
      </pl-question-panel>
      <div style="padding: 12px; background: #0f172a; border-radius: 6px; border: 1px solid #334155;">
        <span class="pl-number-input form-inline">
          <span class="pl-number-input-label" style="color: #94a3b8; font-family: monospace; margin-right: 8px;">$v_{0y} = $</span>
          <span class="input-group">
            <input name="_q_submission_v_0y" type="text" class="form-control pl-input-element" placeholder="number" style="background: #1e293b; border: 1px solid #475569; color: #f8fafc; padding: 6px 10px; border-radius: 6px; width: 130px; font-size: 14px;">
            <span class="input-group-append" style="color: #94a3b8; font-family: monospace; margin-left: 6px;">m/s</span>
          </span>
        </span>
      </div>
    </div>
  </form>
</div>`,
    options: []
  }
];

let currentIndex = parseInt(sessionStorage.getItem('sample_quiz_index') || '0', 10);
if (isNaN(currentIndex) || currentIndex < 0 || currentIndex >= questions.length) {
  currentIndex = 0;
}

const questionBadge = document.getElementById('questionBadge');
const progressBar = document.getElementById('progressBar');
const questionStem = document.getElementById('questionStem');
const visualMediaContainer = document.getElementById('visualMediaContainer');
const quizCanvas = document.getElementById('quizCanvas');
const optionsGroup = document.getElementById('optionsGroup');
const btnPrev = document.getElementById('btnPrev');
const btnReloadPart = document.getElementById('btnReloadPart');
const btnNext = document.getElementById('btnNext');

function drawTriangleDiagram() {
  if (!quizCanvas) return;
  const ctx = quizCanvas.getContext('2d');
  ctx.clearRect(0, 0, quizCanvas.width, quizCanvas.height);

  // Background
  ctx.fillStyle = '#0b0f19';
  ctx.fillRect(0, 0, quizCanvas.width, quizCanvas.height);

  // Triangle coordinates: Right triangle with legs 120px (horizontal) and 90px (vertical)
  const ox = 70;
  const oy = 160;
  const legA = 200; // base (adjacent to theta at ox)
  const legB = 130; // height (opposite)

  // Draw lines
  ctx.beginPath();
  ctx.moveTo(ox, oy); // angle theta
  ctx.lineTo(ox + legA, oy); // right angle vertex
  ctx.lineTo(ox + legA, oy - legB); // top vertex
  ctx.closePath();

  ctx.strokeStyle = '#6366f1';
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = 'rgba(99, 102, 241, 0.1)';
  ctx.fill();

  // Right angle symbol
  const sq = 16;
  ctx.beginPath();
  ctx.moveTo(ox + legA - sq, oy);
  ctx.lineTo(ox + legA - sq, oy - sq);
  ctx.lineTo(ox + legA, oy - sq);
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Arc for angle theta
  ctx.beginPath();
  ctx.arc(ox, oy, 30, 0, -Math.atan(legB / legA), true);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Text labels
  ctx.font = 'bold 15px -apple-system, sans-serif';
  ctx.fillStyle = '#f8fafc';

  // Base label: "Adjacent = 8"
  ctx.fillText('Adjacent = 8', ox + legA / 2 - 40, oy + 22);

  // Height label: "Opposite = 6"
  ctx.fillText('Opposite = 6', ox + legA + 12, oy - legB / 2);

  // Hypotenuse label: "c = ?"
  ctx.fillText('c = ?', ox + legA / 2 - 25, oy - legB / 2 - 10);

  // Theta symbol
  ctx.fillStyle = '#f59e0b';
  ctx.fillText('θ', ox + 38, oy - 10);
}

function renderQuestion() {
  const q = questions[currentIndex];

  // Update header and progress
  questionBadge.textContent = `Question ${currentIndex + 1} of ${questions.length}`;
  progressBar.style.width = `${((currentIndex + 1) / questions.length) * 100}%`;

  // Update question stem
  if (q.stemHtml) {
    questionStem.innerHTML = q.stemHtml;
  } else {
    questionStem.textContent = `${q.id}. ${q.stem}`;
  }

  // Canvas display
  if (q.hasCanvas) {
    visualMediaContainer.classList.remove('hidden');
    drawTriangleDiagram();
  } else {
    visualMediaContainer.classList.add('hidden');
  }

  // Update choices (This triggers the content script's MutationObserver!)
  optionsGroup.innerHTML = '';
  if (q.options && q.options.length > 0) {
    optionsGroup.style.display = 'flex';
    q.options.forEach((opt, idx) => {
      const label = document.createElement('label');
      label.className = 'choice-label';
      label.innerHTML = `
        <input type="radio" name="quizChoice" value="${idx}" id="opt_${idx}">
        <span>${opt}</span>
      `;
      label.querySelector('input').addEventListener('change', () => {
        document.querySelectorAll('.choice-label').forEach(l => l.classList.remove('selected'));
        label.classList.add('selected');
      });
      optionsGroup.appendChild(label);
    });
  } else {
    optionsGroup.style.display = 'none';
  }

  // Update button states
  btnPrev.disabled = currentIndex === 0;
  if (currentIndex === questions.length - 1) {
    btnNext.textContent = 'Restart Quiz ↺';
  } else {
    btnNext.textContent = 'Next Question →';
  }
}

btnPrev.addEventListener('click', () => {
  if (currentIndex > 0) {
    currentIndex--;
    sessionStorage.setItem('sample_quiz_index', currentIndex);
    renderQuestion();
  }
});

btnNext.addEventListener('click', () => {
  if (currentIndex < questions.length - 1) {
    currentIndex++;
  } else {
    currentIndex = 0;
  }
  sessionStorage.setItem('sample_quiz_index', currentIndex);
  renderQuestion();
});

if (btnReloadPart) {
  btnReloadPart.addEventListener('click', () => {
    // Save current question index and simulate full page reload
    sessionStorage.setItem('sample_quiz_index', currentIndex);
    location.reload();
  });
}

// Initial render
document.addEventListener('DOMContentLoaded', () => {
  renderQuestion();
});
