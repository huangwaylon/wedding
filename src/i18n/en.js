/**
 * English catalog. Flat keys, dot-namespaced by surface.
 *
 * A pluralised value is an object keyed by CLDR category — the only case where a
 * value is not a string. `test/i18n.test.js` fails on a key nothing references, a
 * referenced key that is missing here, and a key `ja.js` does not also have.
 */
export default {
  'app.name': 'Wedding',

  'common.cancel': 'Cancel',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.close': 'Close',
  /* The read/edit toggle inside an open row. Two words for one control, because a toggle that
     does not say which way it is about to go is a guess. */
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
  /* The count that makes the figure above it checkable by arithmetic, and what replaced a
     pace sentence that could be wrong — see OverallCard. No noun is counted, so this is a
     plain string rather than a plural object. */
  'overall.summary': '{done} of {count} done',
  'overall.expected': '{count} of {total} dates have passed',
  'overall.overdue': { one: '{count} overdue', other: '{count} overdue' },

  'state.done': 'Done',
  'state.overdue': 'Overdue',
  'state.soon': 'Soon',
  'state.later': 'Later',
  'state.nodate': 'No date',

  /* How near the due date is, and the only urgency wording on a row. Nothing is rendered
     past the fortnight, so there is no key for it. */
  'due.ago': { one: '{count} day ago', other: '{count} days ago' },
  'due.today': 'Today',
  'due.tomorrow': 'Tomorrow',
  'due.in': { one: 'in {count} day', other: 'in {count} days' },

  'filter.all': 'All',
  'filter.label': 'Show',

  'list.emptyFiltered': 'Nothing matches.',
  'list.showAll': 'Show everything',
  /* The collapsed row's accessible name, and the one place the date is spelled out in full:
     the visible row leans on a bare day number plus the sticky month heading, and neither of
     those reaches a screen reader. It states the state in WORDS, so the dot's colour is never
     the only channel. */
  'plan.cardLabel': '{title}: {when}, {state}',
  'plan.cardLabelSubs': '{title}: {when}, {state}, {subs}',
  /* The one heading in the board that is the wedding's own month. An aside on the month name,
     not a sentence: it sits inside a 13px sticky heading that already holds a figure. */
  'plan.theDay': 'the day',
  'list.subtasks': {
    one: '{done} of {count} subtask',
    other: '{done} of {count} subtasks',
  },
  'list.subtaskAdd': 'Add a subtask',
  'list.markDone': 'Mark {title} done',
  'list.markNotDone': 'Mark {title} not done',
  /* A STATE, not an action — these name a tick nobody can press: a viewer's row, and the
     detail sheet's read-only checklist. Without them a screen reader gets the title and no
     way to tell a ticked item from an open one, since the glyph is decorative. */
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
  'settings.maintenance': 'Maintenance',
  'settings.compact': 'Purge deleted tasks',
  'settings.compactHint': { one: 'Removes {count} tombstoned row for good.', other: 'Removes {count} tombstoned rows for good.' },
  'settings.compacted': 'Deleted tasks purged.',
  'settings.saved': 'Settings saved.',

  'accent.rose': 'Rose',
  'accent.sage': 'Sage',
  'accent.indigo': 'Indigo',
  'accent.plum': 'Plum',
  'accent.gold': 'Gold',

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
  /* IT NO LONGER POINTS AT A NOTICE, because for the failures that produce this toast there is
     not one. It used to read "See the notice at the top, or try again" — but a persistent notice
     is rendered only for a TERMINAL code, and `busy` and `transient` are deliberately excluded
     from that set as the two retryable ones. So the only writes that told somebody to look up
     were the only ones with nothing up there to look at. */
  'toast.failed': 'Nothing was saved. Try again.',
  'toast.deleted': 'Task deleted.',

  'api.unconfigured': 'This build has no endpoint address',
  'api.unconfiguredHint':
    'VITE_SCRIPT_URL was empty when the site was built. See SETUP.md.',
  'api.outdated': 'Saving is paused: the spreadsheet’s script is out of date',
  /* This used to say "subtasks cannot be saved", which was true of an APPENDED column and
     dangerously wrong once one was renamed: the old script silently dropped every due date it
     was handed. Nothing that touches a task is written until it is redeployed. */
  'api.outdatedHint':
    'It cannot store every field this version writes, so nothing on the board can be saved until it is updated — a save would drop the values it has never heard of. Dates are still shown from the old column, so nothing is lost. In the sheet: Extensions › Apps Script, paste the current Code.gs, then Deploy › Manage deployments › New version.',
  'api.unauthorized': 'The edit link was refused',
  'api.not_empty': 'That spreadsheet already has other tabs',
  'api.not_emptyHint':
    'The script refused to add its tabs to a spreadsheet somebody is using. Bind it to an empty one.',
  'api.misconfigured': 'The script is not attached to a spreadsheet',
  'api.misconfiguredHint':
    'It has to be created from the sheet via Extensions › Apps Script. See SETUP.md.',
  'api.busy': 'Somebody else was saving. Try again.',
  'api.not_found': 'That task is no longer in the sheet.',
  'api.transient': 'Could not reach the board.',
}
