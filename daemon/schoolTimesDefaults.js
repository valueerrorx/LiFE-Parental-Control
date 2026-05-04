/* SPDX-License-Identifier: GPL-3.0-or-later; Copyright (c) 2026 Thomas Michael Weissel; Licensed under GPLv3+ (see http://www.gnu.org/licenses/). */
'use strict';

/** Default Mon–Fri school window per weekday (must match src/shared/schoolTimes.js). */
function defaultSchoolTimes() {
    const slot = { from: '07:50', to: '13:10' };
    return {
        mon: { ...slot },
        tue: { ...slot },
        wed: { ...slot },
        thu: { ...slot },
        fri: { ...slot }
    };
}

module.exports = { defaultSchoolTimes };
