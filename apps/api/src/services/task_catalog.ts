import type { AtomicSkill, SkillGroup, TaskTemplate } from '@hackathon/shared'

const groups: SkillGroup[] = [
  {
    code: 'communication',
    name: 'Communication',
    description: 'Compose, interpret, and follow up on everyday workplace communication.',
    kind: 'office',
    skills: [
      skill('draft_email', 'Draft an email', 'Draft a clear email for a recipient about a specific subject and desired outcome.', ['recipient', 'subject', 'tone', 'desired outcome']),
      skill('summarize_email_thread', 'Summarize an email thread', 'Condense an email thread into context, decisions, open questions, and next steps.', ['email thread']),
      skill('draft_reply', 'Draft an email reply', 'Prepare a reply that addresses the sender’s questions and preserves the requested tone.', ['incoming email', 'reply points', 'tone']),
      skill('draft_followup_message', 'Draft a follow-up message', 'Write a concise follow-up after a meeting, request, or missed response.', ['recipient', 'prior interaction', 'next action', 'due date']),
    ],
  },
  {
    code: 'planning',
    name: 'Planning & scheduling',
    description: 'Turn availability, deadlines, and meeting goals into scheduled work.',
    kind: 'office',
    skills: [
      skill('find_meeting_time', 'Find a meeting time', 'Find a time window that works for the required attendees and duration.', ['attendees', 'date range', 'duration', 'time zone']),
      skill('create_calendar_event', 'Create a calendar event', 'Create a calendar event with attendees, location, agenda, and reminders.', ['title', 'attendees', 'date', 'time', 'location']),
      skill('draft_meeting_agenda', 'Draft a meeting agenda', 'Create an ordered agenda with objectives, topics, owners, and time boxes.', ['meeting objective', 'topics', 'attendees', 'duration']),
      skill('create_reminder', 'Create a reminder', 'Create a reminder for a person, deadline, and required action.', ['action', 'owner', 'due date', 'reminder time']),
    ],
  },
  {
    code: 'research',
    name: 'Research & information',
    description: 'Find, compare, and distill information into evidence that supports a decision.',
    kind: 'office',
    skills: [
      skill('research_topic', 'Research a topic', 'Find current, credible sources about a focused business question.', ['question', 'scope', 'source requirements']),
      skill('compare_vendors', 'Compare vendors', 'Compare vendors using the same requirements, pricing, risks, and evidence.', ['vendors', 'requirements', 'budget', 'decision criteria']),
      skill('find_business_contact', 'Find a business contact', 'Find the appropriate public contact for a company, role, or department.', ['company', 'role or department', 'location']),
      skill('summarize_webpage', 'Summarize a webpage', 'Summarize a webpage’s key claims, evidence, dates, and implications.', ['webpage URL', 'focus']),
    ],
  },
  {
    code: 'travel_location',
    name: 'Travel & location',
    description: 'Resolve location, route, timing, weather, and travel choices.',
    kind: 'office',
    skills: [
      skill('check_weather', 'Check weather', 'Check the forecast for a city at a specified date and time.', ['city', 'date', 'time']),
      skill('plot_driving_directions', 'Plot driving directions', 'Plot a driving route between two addresses with distance and major steps.', ['origin address', 'destination address', 'departure time']),
      skill('estimate_travel_time', 'Estimate travel time', 'Estimate door-to-door travel time for a route and departure window.', ['origin', 'destination', 'departure time', 'travel mode']),
      skill('find_cheapest_flight', 'Find the cheapest flight', 'Find the lowest-cost reasonable flight for a route and travel window.', ['origin airport', 'destination airport', 'departure date', 'return date', 'time constraints']),
    ],
  },
  {
    code: 'documents_data',
    name: 'Documents & data',
    description: 'Create and transform the documents and structured data used in office work.',
    kind: 'office',
    skills: [
      skill('summarize_document', 'Summarize a document', 'Summarize a document’s purpose, facts, obligations, risks, and decisions.', ['document', 'focus']),
      skill('extract_action_items', 'Extract action items', 'Extract actions, owners, dates, and dependencies from source material.', ['document or notes']),
      skill('draft_document', 'Draft a document', 'Draft a structured business document for a stated audience and purpose.', ['document type', 'audience', 'purpose', 'source material']),
      skill('create_spreadsheet_table', 'Create a spreadsheet table', 'Create a clean table with defined columns, rows, and calculation requirements.', ['dataset', 'columns', 'calculations', 'output format']),
    ],
  },
  {
    code: 'accounting',
    name: 'Accounting',
    description: 'Atomic bookkeeping actions for customer, vendor, banking, and purchasing workflows.',
    kind: 'accounting',
    skills: [
      skill('create_customer_invoice', 'Create a customer invoice', 'Create an invoice with the customer, items, terms, taxes, and due date.', ['customer', 'items', 'amounts', 'terms', 'due date'], 'accounting'),
      skill('receive_customer_payment', 'Receive a customer payment', 'Apply an incoming customer payment to the correct open invoice or account.', ['customer', 'payment amount', 'payment method', 'invoice'], 'accounting'),
      skill('create_sales_receipt', 'Create a sales receipt', 'Record a sale and payment received at the same time.', ['customer', 'items', 'amounts', 'payment method'], 'accounting'),
      skill('enter_vendor_bill', 'Enter a vendor bill', 'Record a vendor bill with coding, terms, due date, and supporting document.', ['vendor', 'bill number', 'expense or item coding', 'amount', 'due date'], 'accounting'),
      skill('pay_vendor_bill', 'Pay a vendor bill', 'Select an approved open bill and record its payment from the correct account.', ['vendor', 'bill', 'payment account', 'payment date', 'payment method'], 'accounting'),
      skill('write_check', 'Write a check', 'Create a check with payee, account coding, amount, memo, and check date.', ['payee', 'bank account', 'amount', 'coding', 'memo'], 'accounting'),
      skill('record_bank_deposit', 'Record a bank deposit', 'Group received funds and record the deposit to the matching bank account.', ['payments', 'bank account', 'deposit date', 'deposit reference'], 'accounting'),
      skill('reconcile_bank_account', 'Reconcile a bank account', 'Match statement activity to the ledger and resolve outstanding differences.', ['bank account', 'statement period', 'ending balance'], 'accounting'),
      skill('create_purchase_order', 'Create a purchase order', 'Create a purchase order with vendor, items, quantities, pricing, and approvals.', ['vendor', 'items', 'quantities', 'pricing', 'approver'], 'accounting'),
      skill('run_ap_aging_report', 'Run an AP aging report', 'Generate open vendor balances grouped by aging period as of a specified date.', ['as-of date', 'vendor filter', 'aging periods'], 'accounting'),
    ],
  },
]

const templateDefinitions = [
  template('weekly_ap_run', 'Weekly AP run', 'Review open payables, enter approved bills, and pay what is due.', ['run_ap_aging_report', 'enter_vendor_bill', 'pay_vendor_bill']),
  template('customer_invoice_to_deposit', 'Customer invoice to deposit', 'Invoice a customer, receive payment, and record the bank deposit.', ['create_customer_invoice', 'receive_customer_payment', 'record_bank_deposit']),
  template('business_trip_planning', 'Business trip planning', 'Choose travel, check conditions, plan the ground route, and brief the traveler.', ['find_cheapest_flight', 'check_weather', 'plot_driving_directions', 'draft_email']),
  template('meeting_followup', 'Meeting follow-up', 'Turn a meeting into owned actions, calendar commitments, and a written follow-up.', ['extract_action_items', 'create_calendar_event', 'draft_followup_message']),
  template('vendor_selection', 'Vendor selection', 'Research the market, compare vendors consistently, and prepare a recommendation.', ['research_topic', 'compare_vendors', 'create_spreadsheet_table', 'draft_email']),
]

const skillsByCode = new Map(groups.flatMap((group) => group.skills).map((item) => [item.code, item]))

export function taskSkillGroups(): SkillGroup[] {
  return groups
}

export function taskTemplates(): TaskTemplate[] {
  return templateDefinitions.map((item) => ({
    ...item,
    skills: resolveSkills(item.skillCodes),
  }))
}

export function resolveSkills(codes: string[]): AtomicSkill[] {
  return codes.map((code) => {
    const item = skillsByCode.get(code)
    if (!item) throw new Error(`Unknown skill: ${code}`)
    return item
  })
}

export function knownSkillCodes(): Set<string> {
  return new Set(skillsByCode.keys())
}

function skill(
  code: string,
  name: string,
  description: string,
  inputs: string[],
  kind: AtomicSkill['kind'] = 'office'
): AtomicSkill {
  return { code, name, description, inputs, kind }
}

function template(code: string, name: string, description: string, skillCodes: string[]) {
  return { code, name, description, skillCodes }
}
