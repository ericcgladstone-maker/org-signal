// Model updated 2026-09-16: claude-sonnet-5.
// Dateless aliases only — dated snapshots (e.g. 'claude-sonnet-4-20250514')
// are retired on a schedule and then 404 with no failover.
// Token budgets raised: Sonnet 5 runs adaptive thinking by default and
// thinking tokens come out of max_tokens, so the old ceilings left too
// little room for the visible answer. max_tokens is a ceiling, not a
// spend — raising it costs nothing unless used.
'use strict';
// ═══════════════════════════════════════════════════════════════════════════════
// OrgSignal — Configuration
// All tunable parameters live here. This is the explicit extensibility signal
// for an acquirer: change DOMAIN to adapt the pipeline to any communication
// dataset; change MODEL_ID to upgrade the AI backbone.
// ═══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // ── AI backbone ──────────────────────────────────────────────────────────────
  MODEL_ID:    'claude-sonnet-5',
  API_VERSION: '2023-06-01',
  API_URL:     'https://api.anthropic.com/v1/messages',

  // ── Domain constant ───────────────────────────────────────────────────────────
  // Change this to adapt OrgSignal to a different communication platform
  // (e.g., 'microsoft-teams', 'email-threads', 'discord').
  DOMAIN: 'slack',

  // ── Analysis pipeline ─────────────────────────────────────────────────────────
  PER_PERSON_MAX_TOKENS:   6000,
  ORG_SYNTHESIS_MAX_TOKENS: 12000,
  HR_NORMALIZE_MAX_TOKENS: 10000,
  ANALYST_MAX_TOKENS:      8000,
  SECONDARY_INSIGHT_MAX_TOKENS: 4000,

  // Max messages sampled per person for LLM analysis
  SAMPLE_PUB_MSGS:  15,
  SAMPLE_PRIV_MSGS: 12,
  SAMPLE_DM_MSGS:   13,

  // Parallel analysis batch size (keep low to avoid rate limits)
  ANALYSIS_BATCH_SIZE: 3,
  BATCH_PAUSE_MS:      800,

  // ── Web search ────────────────────────────────────────────────────────────────
  // Web search is enabled only for the analyst chat and secondary insights —
  // flows where comparative/research context genuinely improves the output.
  // Per-person analysis and org synthesis use only the uploaded data.
  WEB_SEARCH_MAX_USES: 3,

  // ── Network metric thresholds ─────────────────────────────────────────────────
  HIDDEN_INFLUENCER_VISIBILITY_THRESHOLD: -0.25,
  HIDDEN_INFLUENCER_MIN_DIRECT_DEGREE:     3,
  ASYMMETRIC_MIN_DEGREE:                   5,
  ASYMMETRIC_MAX_RECIPROCITY:              0.55,
  INAUTHENTICITY_DIVERGENCE_THRESHOLD:     0.35,
  MIN_MESSAGES_FOR_PERSON:                 3,

  // ── Findings ─────────────────────────────────────────────────────────────────
  MAX_HIDDEN_INFLUENCER_FINDINGS: 2,
  MAX_ASYMMETRIC_FINDINGS:        2,
  MAX_INAUTHENTICITY_FINDINGS:    2,
};
