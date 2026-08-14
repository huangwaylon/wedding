/**
 * English catalog. Flat keys, dot-namespaced by surface. A pluralised value is an object keyed by
 * CLDR category, the only non-string case. `test/i18n.test.js` fails on a key nothing references, a
 * referenced key missing here, and a key `ja.js` does not also have.
 */
export default {
  'app.name': 'Wedding',

  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.close': 'Close',
  /* Two words for one control: a toggle not saying which way it will go is a guess. */
  'common.edit': 'Edit',
  'common.editDone': 'Done',
  'common.restore': 'Restore',
  'common.settings': 'Settings',
  'common.dash': '–',
  'common.saving': 'Saving…',
  'common.loading': 'Loading the board…',

  'access.viewOnly': 'View only',
  'access.rejected': 'This edit link was rejected',
  'access.rejectedHint': 'Ask for the current link, or paste it in Settings.',
  'access.pasteLabel': 'Paste your edit link',
  'access.pasteHint':
    'Only needed if the link did not carry over — an installed app has its own storage.',
  'access.pasteAction': 'Enable editing',
  'access.pasteBad': 'That does not look like an edit link.',
  'access.pasteOk': 'Editing enabled on this device.',
  'access.revoke': 'Stop editing on this device',
  'access.revokeHint': 'Removes the key from this device only. The link still works.',
  'access.revoked': 'This device is now view-only.',

  'countdown.days': { one: '{count} day to go', other: '{count} days to go' },
  'countdown.today': 'Today is the day',
  'countdown.past': { one: '{count} day ago', other: '{count} days ago' },
  'countdown.unset': 'No wedding date set',

  'overall.title': 'Overall progress',
  /* The count that makes the percentage checkable by arithmetic, in place of a pace sentence that
     could be wrong. No noun is counted, so this is a plain string. */
  'overall.summary': '{done} of {count} done',
  'overall.expected': '{count} of {total} dates have passed',

  'state.done': 'Done',
  'state.overdue': 'Overdue',
  'state.soon': 'Soon',
  'state.later': 'Later',
  'state.nodate': 'No date',

  /* The only urgency wording on a row. Nothing renders past the fortnight, so there is no key for
     it. */
  'due.ago': { one: '{count} day ago', other: '{count} days ago' },
  'due.today': 'Today',
  'due.tomorrow': 'Tomorrow',
  'due.in': { one: 'in {count} day', other: 'in {count} days' },

  'filter.all': 'All',
  'filter.label': 'Show',

  /* The two destinations. Each button carries this word as well as a glyph. */
  'tab.label': 'Views',
  'tab.plan': 'Plan',
  'tab.notes': 'Notes',

  'notes.label': 'What has been decided',
  'notes.placeholder': '# Venue\n- Booked the pavilion\n- Deposit paid',
  'notes.emptyTitle': 'Nothing written down yet',
  'notes.emptyEditor': 'Keep what has been settled here — the venue, the caterer, who is bringing what.',
  'notes.emptyViewer': 'The couple has not written anything here yet.',
  /* On the editor, where somebody is about to type. The board is world-readable by design. */
  'notes.public': 'Anybody with the link can read this. Keep bank details and passwords out of it.',
  'notes.bold': 'Bold',
  'notes.italic': 'Italic',
  'notes.heading': 'Heading',
  'notes.bullets': 'Bullet list',

  'list.emptyFiltered': 'Nothing matches.',
  'list.showAll': 'Show everything',
  /* The collapsed row's accessible name, and the one place the date is spelled out in full: the
     visible row leans on a bare day number plus the sticky heading, and neither reaches a screen
     reader. It states the state in WORDS, so the dot's colour is never the only channel. */
  'plan.cardLabel': '{title}: {when}, {state}',
  'plan.cardLabelSubs': '{title}: {when}, {state}, {subs}',
  /* An aside on the wedding month's name, not a sentence: it sits in a 13px heading already holding
     a figure. */
  'plan.theDay': 'the day',
  'list.subtasks': {
    one: '{done} of {count} subtask',
    other: '{done} of {count} subtasks',
  },
  'list.subtaskAdd': 'Add a subtask',
  'list.markDone': 'Mark {title} done',
  'list.markNotDone': 'Mark {title} not done',
  /* A STATE, not an action: these name a tick nobody can press. Without them a screen reader gets
     the title and no way to tell a ticked item from an open one, the glyph being decorative. */
  'list.isDone': 'Done: {title}',
  'list.isNotDone': 'Not done: {title}',
  'list.deleteTask': 'Delete {title}',

  'empty.title': 'The board is empty',
  'empty.viewer': 'Nothing added yet.',
  'empty.needsDate': 'A checklist counts back from the wedding date.',
  'empty.setDate': 'Set the wedding date',
  'empty.seeding': 'Building the checklist…',
  'empty.seeded': { one: 'Added {count} task.', other: 'Added {count} tasks.' },

  'template.classic12': 'Twelve-month plan',
  'template.japan8': 'Japanese eight-month plan',
  'template.count': { one: '{count} task', other: '{count} tasks' },
  'template.use': 'Use this checklist',

  'form.newTitle': 'New task',
  'form.title': 'Title',
  'form.titlePlaceholder': 'Book the venue',
  'form.category': 'Category',
  'form.categoryNone': 'No category',
  'form.due': 'Due',
  'form.deleteThis': 'Delete this task',

  'error.MISSING_TITLE': 'Give the task a name.',
  'error.MISSING_DUE': 'Give the task a due date.',
  'error.BAD_DUE': 'That is not a real date.',
  /* A spreadsheet cell holds 50,000 characters, so this is refused before it is sent: past the limit
     the write 400s, which the taxonomy reads as a setup mistake. */
  'error.NOTES_TOO_LONG': 'Too long to save. The limit is {count} characters.',

  'confirm.deleteTitle': 'Delete this task?',
  'confirm.deleteBody': '“{title}” goes to the Deleted list, where you can put it back.',
  'confirm.deleteSubtasks': {
    one: 'Its {count} subtask goes with it.',
    other: 'Its {count} subtasks go with it.',
  },

  'deleted.title': { one: 'Deleted ({count})', other: 'Deleted ({count})' },
  'deleted.restored': 'Task restored.',

  'settings.title': 'Settings',
  'settings.couple': 'The couple',
  'settings.partner1': 'One of you',
  'settings.partner2': 'The other',
  'settings.wedding': 'The wedding',
  'settings.weddingDate': 'Date',
  'settings.venue': 'Venue',
  'settings.timezone': 'Time zone',
  'settings.timezoneHint': 'Every time on the board is read in this zone.',
  'settings.timezoneBad': 'Not a time zone name. Try Asia/Tokyo or America/Los_Angeles.',
  'settings.timezoneMismatch':
    'The spreadsheet itself is set to {zone}. Times typed straight into the sheet may land off.',
  'settings.categories': 'Categories',
  'settings.categoriesHint': 'Comma separated.',
  'settings.device': 'This device only',
  'settings.language': 'Language',
  'settings.accent': 'Colour',
  'settings.access': 'Editing',
  /* A view preference, not an access change: the wording must make that unmistakable, or it reads
     as the revoke below. */
  'settings.readOnlyHint':
    'See the board exactly as your guests see it. Your edit link stays on this device.',
  'settings.readOnlyOn': 'Switch to the read-only view',
  'settings.readOnlyOff': 'Leave the read-only view',
  'settings.maintenance': 'Maintenance',
  'settings.compact': 'Purge deleted tasks',
  'settings.compactHint': { one: 'Removes {count} tombstoned row for good.', other: 'Removes {count} tombstoned rows for good.' },
  'settings.compacted': 'Deleted tasks purged.',
  'settings.saved': 'Settings saved.',

  'accent.tarn': 'Tarn',
  'accent.pine': 'Pine',
  'accent.rosehip': 'Rosehip',

  'category.budget': 'Budget',
  'category.venue': 'Venue',
  'category.guests': 'Guests',
  'category.vendors': 'Vendors',
  'category.attire': 'Attire',
  'category.food': 'Food',
  'category.stationery': 'Stationery',
  'category.photo': 'Photo',
  'category.music': 'Music',
  'category.beauty': 'Beauty',
  'category.gifts': 'Gifts',
  'category.paperwork': 'Paperwork',
  'category.honeymoon': 'Honeymoon',
  'category.other': 'Other',

  'status.stale': 'Showing saved data',
  'status.staleHint': 'The last copy this device saw.',
  'status.refresh': 'Refresh',

  'toast.saved': 'Saved.',
  /* It must stand alone and may not point at a notice: one renders only for a TERMINAL code, and
     `transient` — the retryable one producing most of these — is excluded from that set. */
  'toast.failed': 'Nothing was saved. Try again.',
  'toast.deleted': 'Task deleted.',

  'api.unconfigured': 'This build has no endpoint address',
  'api.unconfiguredHint':
    'VITE_SCRIPT_URL was empty when the site was built. See README.md.',
  'api.unauthorized': 'The edit link was refused',
  'api.not_empty': 'That spreadsheet already has other tabs',
  'api.not_emptyHint':
    'The script refused to add its tabs to a spreadsheet somebody is using. Bind it to an empty one.',
  /* One code for every way the deployment can be wrong: a script bound to no spreadsheet, a scope
     too narrow for the Sheets API, an id that names nothing. All three are setup mistakes, so the
     hint points at the setup. */
  'api.misconfigured': 'The board could not be opened',
  'api.misconfiguredHint':
    'The script’s spreadsheet or its permissions are not set up correctly. It has to be created from the sheet via Extensions › Apps Script, with the spreadsheets scope. See README.md.',
  'api.not_found': 'That task is no longer in the sheet.',
  'api.transient': 'Could not reach the board.',
}
