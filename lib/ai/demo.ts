import { identifySample } from "@/lib/samples";
import type { ModelFinding } from "./schema";
import type { NormalizedReview, NormalizedTests } from "./parse";

export interface DemoReviewInput {
  code: string;
  filename?: string | null;
  language?: string | null;
  focus?: string | null;
}

const CHECKOUT_FINDINGS: ModelFinding[] = [
  {
    title: "SQL injection in the coupon lookup",
    severity: "critical",
    category: "security",
    file: "src/checkout.ts",
    lineStart: null,
    lineEnd: null,
    evidence: [
      "  const cart = await db.query(",
      "    `SELECT * FROM carts WHERE id = '${cartId}'`",
      "  );",
    ].join("\n"),
    explanation:
      "cartId is interpolated directly into SQL, so a value such as \"x' OR '1'='1\" changes the query. couponCode has the same problem on the next query.",
    fix:
      "Use a parameterized query for every value: db.query('SELECT * FROM carts WHERE id = $1', [cartId]). Validate that cartId and couponCode are the expected format before querying.",
    confidence: 0.96,
  },
  {
    title: "Unparameterized UPDATE lets a caller write the cart total",
    severity: "critical",
    category: "security",
    file: "src/checkout.ts",
    lineStart: null,
    lineEnd: null,
    evidence: [
      "  await db.query(",
      "    `UPDATE carts SET total = ${discounted} WHERE id = '${cartId}'`",
      "  );",
    ].join("\n"),
    explanation:
      "Both the computed total and the cart id are interpolated into the UPDATE. A crafted cartId can append SQL, and the unrounded numeric value is written straight into a money column.",
    fix:
      "Parameterize the statement: db.query('UPDATE carts SET total = $1 WHERE id = $2', [discounted, cartId]). Round money in integer cents and verify the cart belongs to the caller.",
    confidence: 0.93,
  },
  {
    title: "Discount treats a percentage as a fraction",
    severity: "high",
    category: "bug",
    file: "src/checkout.ts",
    lineStart: null,
    lineEnd: null,
    evidence: "  const discounted = cart.rows[0].total * (1 - percent);",
    explanation:
      "Coupons store percent as 0-100 (for example 20). Subtracting it directly makes the multiplier -19, so a 20% coupon turns a 100.00 cart into -1900.00.",
    fix: "Convert the percentage once: const rate = percent / 100; const discounted = cart.rows[0].total * (1 - rate); and clamp percent to 0..100.",
    confidence: 0.97,
  },
  {
    title: "JWT signing falls back to a hardcoded secret",
    severity: "high",
    category: "security",
    file: "src/checkout.ts",
    lineStart: null,
    lineEnd: null,
    evidence: "  const token = sign({ sub: user.id }, process.env.JWT_SECRET || DEV_SECRET);",
    explanation:
      "If JWT_SECRET is unset, sessions are signed with the source-visible DEV_SECRET. An attacker can forge a token for any user id in production.",
    fix:
      "Fail closed when the secret is missing: read it once at startup, validate its length, and throw instead of using a fallback. Remove DEV_SECRET from the module.",
    confidence: 0.92,
  },
  {
    title: "Unhandled JSON.parse turns malformed input into a 500",
    severity: "medium",
    category: "error-handling",
    file: "src/checkout.ts",
    lineStart: null,
    lineEnd: null,
    evidence: "  const payload = JSON.parse(raw);",
    explanation:
      "loadCart accepts an unvalidated string and lets a SyntaxError escape. Any malformed body produces an unhandled 500 instead of a 400, and the parsed shape is never checked.",
    fix:
      "Wrap parsing in try/catch, validate the parsed value with a schema, and return a typed 400. Confirm payload.items is an array before returning it.",
    confidence: 0.88,
  },
  {
    title: "Coupon percentage is not validated before arithmetic",
    severity: "medium",
    category: "bug",
    file: "src/checkout.ts",
    lineStart: null,
    lineEnd: null,
    evidence: "  const percent = Number(coupon.rows[0].percent);",
    explanation:
      "Number() returns NaN for a corrupt row, and nothing rejects negative values or values above 100. Either case produces a NaN or negative cart total.",
    fix:
      "Validate with Number.isFinite(percent) && percent >= 0 && percent <= 100, and reject the coupon with a clear error when it fails.",
    confidence: 0.84,
  },
  {
    title: "Cart row is read without checking the query result",
    severity: "low",
    category: "error-handling",
    file: "src/checkout.ts",
    lineStart: null,
    lineEnd: null,
    evidence: "    return { total: cart.rows[0].total, applied: false };",
    explanation:
      "If the cart id does not exist, cart.rows is empty and reading .total throws a TypeError. The same assumption appears when computing the discounted total.",
    fix:
      "Check cart.rows.length before use and return a typed not-found result. Do not trust a caller-supplied cart id without an ownership check.",
    confidence: 0.81,
  },
  {
    title: "Checkout changes ship without tests",
    severity: "info",
    category: "tests",
    file: "src/checkout.ts",
    lineStart: null,
    lineEnd: null,
    evidence: "export async function applyCoupon(cartId: string, couponCode: string) {",
    explanation:
      "The submission adds coupon arithmetic, SQL access, token signing, and JSON parsing with no accompanying tests. A single test for a 20% coupon would have caught the discount bug.",
    fix:
      "Add Vitest coverage for valid, expired, and malformed coupons; assert queries are parameterized; and test that signing fails when JWT_SECRET is absent.",
    confidence: 0.7,
  },
];

const ORDERS_FINDINGS: ModelFinding[] = [
  {
    title: "SQL injection in the order history query",
    severity: "critical",
    category: "security",
    file: "src/orders.ts",
    lineStart: null,
    lineEnd: null,
    evidence:
      "    `SELECT * FROM orders WHERE user_id = '${userId}' ORDER BY created_at DESC LIMIT ${pageSize} OFFSET ${offset}`",
    explanation:
      "userId comes straight from the caller and is interpolated into SQL. A crafted id can read another user's orders or append a second statement, depending on the driver.",
    fix:
      "Parameterize the user id and the pagination values: db.query('SELECT ... WHERE user_id = $1 ... LIMIT $2 OFFSET $3', [userId, pageSize, offset]).",
    confidence: 0.95,
  },
  {
    title: "First page is skipped because the offset is one page too large",
    severity: "high",
    category: "bug",
    file: "src/orders.ts",
    lineStart: null,
    lineEnd: null,
    evidence: "  const offset = page * pageSize;",
    explanation:
      "For a 1-based page number, page=1 should start at offset 0, but this computes 20 and silently skips the newest 20 orders. page=0 would read the first page instead, which is probably not the intended API.",
    fix: "Use const offset = Math.max(0, page - 1) * pageSize; and validate page >= 1 at the boundary.",
    confidence: 0.9,
  },
  {
    title: "Unchecked JSON.parse in parseOrder",
    severity: "medium",
    category: "error-handling",
    file: "src/orders.ts",
    lineStart: null,
    lineEnd: null,
    evidence: "  const order = JSON.parse(raw);",
    explanation:
      "Malformed JSON throws an unhandled SyntaxError, and the parsed object is used without checking that items is an array.",
    fix: "Catch the parse error, return a typed 400, and validate the order shape before reducing over items.",
    confidence: 0.86,
  },
  {
    title: "Item prices are summed without type or range checks",
    severity: "low",
    category: "bug",
    file: "src/orders.ts",
    lineStart: null,
    lineEnd: null,
    evidence:
      "    total: order.items.reduce((sum: number, item: any) => sum + item.price, 0),",
    explanation:
      "item is typed any, and a missing or string price turns the total into NaN or string concatenation. Money is also summed as a float.",
    fix:
      "Validate each item with a schema, sum integer cents, and reject unknown shapes instead of relying on any.",
    confidence: 0.79,
  },
  {
    title: "Order queries and parsing have no tests",
    severity: "info",
    category: "tests",
    file: "src/orders.ts",
    lineStart: null,
    lineEnd: null,
    evidence: "export async function listOrders(userId: string, page: number) {",
    explanation:
      "There is no coverage for the first-page offset, invalid page numbers, injected ids, or malformed JSON, which are exactly the paths most likely to break.",
    fix: "Add tests that assert the generated SQL arguments for page 1 and page 2, plus malformed input handling.",
    confidence: 0.68,
  },
];

function heuristicFindings(code: string): ModelFinding[] {
  const lines = code.split(/\r?\n/);
  const findings: ModelFinding[] = [];
  const fired = new Set<string>();

  const add = (
    rule: string,
    index: number,
    finding: Omit<ModelFinding, "evidence" | "lineStart" | "lineEnd"> & { evidence?: string },
  ) => {
    if (fired.has(rule) || findings.length >= 8) return;
    fired.add(rule);
    findings.push({
      ...finding,
      evidence: finding.evidence ?? lines[index].trim(),
      lineStart: null,
      lineEnd: null,
    });
  };

  lines.forEach((line, index) => {
    if (
      /(SELECT|INSERT|UPDATE|DELETE)\b/i.test(line) &&
      /`[^`]*\$\{[^}]+\}[^`]*`/.test(line) &&
      /query|execute|raw|sql/i.test(lines.slice(Math.max(0, index - 2), index + 1).join(" "))
    ) {
      add("sql-interpolation", index, {
        title: "SQL query is built with string interpolation",
        severity: "critical",
        category: "security",
        file: null,
        explanation:
          "A value is interpolated into a SQL string. User-controlled input can change the query instead of being treated as data.",
        fix: "Use parameter placeholders ($1, ?) and pass values as a separate argument array.",
        confidence: 0.8,
      });
    }

    if (/\beval\s*\(|new\s+Function\s*\(/.test(line)) {
      add("eval", index, {
        title: "Dynamic code evaluation",
        severity: "critical",
        category: "security",
        file: null,
        explanation: "eval or new Function executes attacker-controlled text with the process's privileges.",
        fix: "Replace dynamic evaluation with an explicit parser, lookup table, or JSON.parse plus schema validation.",
        confidence: 0.85,
      });
    }

    if (/\.innerHTML\s*=/.test(line)) {
      add("innerhtml", index, {
        title: "Unescaped value assigned to innerHTML",
        severity: "high",
        category: "security",
        file: null,
        explanation: "Assigning untrusted text to innerHTML can execute injected markup or script.",
        fix: "Use textContent, or sanitize with a maintained HTML sanitizer before insertion.",
        confidence: 0.8,
      });
    }

    if (/process\.env\.[A-Z0-9_]*(SECRET|KEY|TOKEN)[A-Z0-9_]*\s*\|\|/.test(line)) {
      add("secret-fallback", index, {
        title: "Secret falls back to a default value",
        severity: "high",
        category: "security",
        file: null,
        explanation: "A missing environment secret silently becomes a fallback, which is often commit-visible and forgeable.",
        fix: "Fail closed when the secret is missing instead of providing a fallback value.",
        confidence: 0.82,
      });
    }

    if (/\b(SECRET|PASSWORD|API_KEY)\b\s*=\s*["'`][^"'`]{8,}["'`]/.test(line)) {
      add("hardcoded-secret", index, {
        title: "Hardcoded credential in source",
        severity: "critical",
        category: "security",
        file: null,
        explanation: "A credential-like literal is embedded in source code and will ship with the repository.",
        fix: "Remove the value, rotate it, and load it from an environment variable or secret manager.",
        confidence: 0.78,
      });
    }

    if (/JSON\.parse\s*\(/.test(line)) {
      // Do not flag a parse that is already guarded by a nearby try/catch;
      // that would be a false positive on ordinary defensive code.
      const before = lines.slice(Math.max(0, index - 6), index).join("\n");
      const after = lines.slice(index, index + 10).join("\n");
      const guarded = /\btry\s*\{/.test(before) && /\bcatch\s*(\([^)]*\))?\s*\{/.test(after);

      if (!guarded) {
        add("json-parse", index, {
          title: "JSON.parse result is used without error handling",
          severity: "medium",
          category: "error-handling",
          file: null,
          explanation: "Malformed input throws a SyntaxError. This call is not inside a visible try/catch, so a bad payload can surface as an unhandled 500.",
          fix: "Catch parse failures, return a typed 4xx, and validate the parsed object with a schema.",
          confidence: 0.55,
        });
      }
    }

    if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)) {
      add("empty-catch", index, {
        title: "Empty catch block swallows errors",
        severity: "medium",
        category: "error-handling",
        file: null,
        explanation: "An empty catch hides failures from callers and logs, making incidents hard to diagnose.",
        fix: "Handle the error, rethrow with context, or log a redacted structured message.",
        confidence: 0.7,
      });
    }

    if (/\bfetch\s*\(/.test(line)) {
      const window = lines.slice(index, index + 9).join("\n");
      if (!/\.ok\b|status\s*[<>=]|response\.status/.test(window)) {
        add("fetch-status", index, {
          title: "fetch response status is not checked",
          severity: "medium",
          category: "error-handling",
          file: null,
          explanation: "fetch resolves for 4xx and 5xx responses. Parsing without checking response.ok treats errors as success.",
          fix: "Check response.ok and throw or return a typed error before reading the body.",
          confidence: 0.6,
        });
      }
    }

    if (/:\s*any\b|<any>/.test(line)) {
      add("any", index, {
        title: "any disables type checking on a value",
        severity: "info",
        category: "maintainability",
        file: null,
        explanation: "An any annotation removes the compiler's ability to catch shape errors at this boundary.",
        fix: "Use a concrete type, unknown plus validation, or a schema-derived type.",
        confidence: 0.6,
      });
    }

    if (/page\s*\*\s*pageSize/.test(line)) {
      add("pagination", index, {
        title: "Pagination offset may skip the first page",
        severity: "medium",
        category: "bug",
        file: null,
        explanation: "If page numbers are 1-based, page * pageSize skips the first page. Confirm the API contract.",
        fix: "Use (page - 1) * pageSize for 1-based paging, and validate the page number.",
        confidence: 0.6,
      });
    }

    if (/Math\.random\s*\(\s*\)/.test(line) && /token|secret|session|id/i.test(line)) {
      add("math-random", index, {
        title: "Math.random used for a security-sensitive value",
        severity: "high",
        category: "security",
        file: null,
        explanation: "Math.random is not cryptographically secure and is predictable enough to guess tokens.",
        fix: "Use crypto.randomUUID() or crypto.getRandomValues() for identifiers and tokens.",
        confidence: 0.75,
      });
    }

    // `x == null` is a deliberate, idiomatic null-or-undefined check, so it is
    // not reported. Other loose comparisons are.
    const nullCheck = /[!=]=\s*(null|undefined)\b/.test(line);
    if (/[^=!<>]==[^=]/.test(line) && !/===/.test(line) && !nullCheck) {
      add("loose-equality", index, {
        title: "Loose equality comparison",
        severity: "low",
        category: "bug",
        file: null,
        explanation: "== performs type coercion, which can make different values compare equal.",
        fix: "Use === / !== unless the coercion is intentional and documented.",
        confidence: 0.45,
      });
    }
  });

  if (!/\b(describe|it|test)\s*\(/.test(code)) {
    const anchor = lines.findIndex((line) => /(export\s+(async\s+)?function|function\s+\w+|const\s+\w+\s*=)/.test(line));
    if (anchor >= 0) {
      add("no-tests", anchor, {
        title: "No tests accompany this code",
        severity: "info",
        category: "tests",
        file: null,
        explanation: "The submission contains no test cases. Critical branches such as error paths and boundary values are unverified.",
        fix: "Add tests for the happy path, boundary values, and each failure branch shown above.",
        confidence: 0.55,
      });
    }
  }

  return findings;
}

export function demoReview(input: DemoReviewInput): NormalizedReview {
  const sample = identifySample(input.code);
  const warnings = ["Sample mode: deterministic local rules. No model was called."];

  if (sample === "checkout") {
    return {
      summary:
        "The checkout module applies coupons, signs sessions, and parses carts. It has two directly exploitable SQL injection sinks and a discount calculation that turns a 20% coupon into a negative total. Secrets and error handling also need work before this ships.",
      findings: CHECKOUT_FINDINGS,
      limitations: [
        "Sample mode uses curated findings for the bundled checkout sample; it is not a live model review.",
        "The absence of tests is inferred from this submission only; the repository may contain tests not shown in the diff.",
      ],
      rejected: 0,
      warnings,
    };
  }

  if (sample === "orders") {
    return {
      summary:
        "The order history module interpolates the user id into SQL and computes a 1-based page offset as page * pageSize, so the first page is skipped. Parsing and money handling are also unchecked.",
      findings: ORDERS_FINDINGS,
      limitations: [
        "Sample mode uses curated findings for the bundled order sample; it is not a live model review.",
        "The absence of tests is inferred from this submission only.",
      ],
      rejected: 0,
      warnings,
    };
  }

  const findings = heuristicFindings(input.code);
  return {
    summary:
      findings.length > 0
        ? `Deterministic rules matched ${findings.length} pattern${findings.length === 1 ? "" : "s"} in this submission. Sample mode is shallow: it does not reason about data flow or intent.`
        : "No deterministic rule matched this submission. Sample mode is intentionally shallow and cannot confirm the code is safe.",
    findings,
    limitations: [
      "Sample mode uses a small fixed rule set, not a language model. It cannot reason about data flow, intent, or framework behavior.",
      "Treat these results as hints and add OPENROUTER_API_KEY for a genuine model review.",
    ],
    rejected: 0,
    warnings,
  };
}

export function demoAsk(input: { question: string; findings: { severity: string; title: string; fix: string; file: string | null; lineStart: number | null; category: string }[] }): string {
  const prefix = "Sample mode: this answer is generated from deterministic rules and the verified finding list, not a model call.\n\n";
  if (input.findings.length === 0) {
    return `${prefix}There are no verified findings to discuss. Run a review first, or switch to a live provider for open-ended questions about the code.`;
  }

  const question = input.question.toLowerCase();
  const findings = input.findings;

  if (/test|coverage|spec/.test(question)) {
    const ideas = findings
      .slice(0, 4)
      .map((finding) => `- ${finding.title}: assert the failure mode and the corrected behavior (${finding.file ?? "location unverified"}${finding.lineStart ? `:${finding.lineStart}` : ""}).`)
      .join("\n");
    return `${prefix}Test ideas drawn from the verified findings:\n\n${ideas}\n\nUse the Generate Tests action for complete suggested test code.`;
  }

  if (/fix|first|priorit|start|next/.test(question)) {
    const ordered = [...findings].sort((a, b) => {
      const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
      return (rank[a.severity] ?? 5) - (rank[b.severity] ?? 5);
    });
    const steps = ordered
      .slice(0, 3)
      .map((finding, index) => `${index + 1}. ${finding.title}\n   ${finding.fix}`)
      .join("\n\n");
    return `${prefix}Fix these in severity order:\n\n${steps}\n\nAfter the fixes, rerun the review to confirm the evidence is gone.`;
  }

  if (/security|exploit|risk|inject/.test(question)) {
    const security = findings.filter((finding) => finding.category === "security");
    if (security.length === 0) {
      return `${prefix}No verified finding is categorised as security. This sample rule set cannot prove the code is secure; it can only report what it recognised.`;
    }
    const list = security
      .map((finding) => `- [${finding.severity}] ${finding.title} (${finding.file ?? "location unverified"}${finding.lineStart ? `:${finding.lineStart}` : ""})`)
      .join("\n");
    return `${prefix}Security findings:\n\n${list}\n\nStart with the critical items, then add regression tests for the corrected query paths.`;
  }

  const top = findings.slice(0, 3);
  const summary = top
    .map((finding) => `- [${finding.severity}] ${finding.title}${finding.lineStart ? ` (line ${finding.lineStart})` : ""}`)
    .join("\n");
  return `${prefix}The highest-signal verified findings are:\n\n${summary}\n\nAsk about tests, security, or what to fix first for a focused answer. A live provider can answer broader questions about the code.`;
}

export function demoTests(input: { code: string; framework?: string | null }): NormalizedTests {
  const sample = identifySample(input.code);
  const warnings = [
    "Sample mode: test suggestions are deterministic and were not executed.",
  ];

  if (sample === "checkout") {
    return {
      summary:
        "Cover the discount contract, SQL parameterization, and coupon validation. These are suggestions, not complete test files.",
      framework: "Vitest",
      rejected: 0,
      warnings,
      cases: [
        {
          title: "20% coupon reduces a 10000-cent cart to 8000",
          testType: "unit",
          setup:
            "Mock db.query to return a 10000-cent cart, then a SAVE20 coupon with percent=20.",
          expected: "applyCoupon resolves with total 8000 and applied=true.",
          finding: "Discount treats a percentage as a fraction",
        },
        {
          title: "Cart id is passed as a SQL parameter",
          testType: "security",
          setup:
            "Call applyCoupon with a cart id containing quotes and SQL, and spy on db.query arguments.",
          expected:
            "The lookup uses a $1 placeholder and the value is passed separately, not interpolated.",
          finding: "SQL injection in the coupon lookup",
        },
        {
          title: "Coupon above 100 percent is rejected",
          testType: "edge-case",
          setup: "Return a coupon with percent=150 and a 10000-cent cart.",
          expected: "applyCoupon rejects with a percent error and runs no update query.",
          finding: "Coupon percentage is not validated before arithmetic",
        },
      ],
    };
  }

  if (sample === "orders") {
    return {
      summary:
        "Cover the 1-based pagination contract, parameterized SQL arguments, and malformed order payloads.",
      framework: "Vitest",
      rejected: 0,
      warnings,
      cases: [
        {
          title: "Page 1 requests offset 0",
          testType: "regression",
          setup: "Mock the query and call listOrders with userId=user_1 and page=1.",
          expected: "The query receives offset 0 and limit 20.",
          finding: "First page is skipped because the offset is one page too large",
        },
        {
          title: "Page 0 is rejected",
          testType: "edge-case",
          setup: "Call listOrders with page=0.",
          expected: "It rejects with a page validation error and runs no query.",
          finding: "First page is skipped because the offset is one page too large",
        },
        {
          title: "User id is passed as a SQL parameter",
          testType: "security",
          setup: "Call listOrders with a user id containing quotes and a SQL expression.",
          expected: "The value is passed separately from the SQL text, not interpolated.",
          finding: "SQL injection in the order history query",
        },
      ],
    };
  }

  return {
    summary:
      "A starting set of test suggestions based on the functions visible in this submission.",
    framework: "Vitest",
    rejected: 0,
    warnings,
    cases: [
      {
        title: "Covers the primary exported behavior",
        testType: "unit",
        setup: "Provide a minimal valid input for the main exported function.",
        expected: "The documented success result is returned.",
        finding: "general coverage",
      },
    ],
  };
}