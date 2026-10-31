<?php
declare(strict_types=1);

require_once __DIR__ . '/../../config.php';
require_once __DIR__ . '/../helpers.php';

function handle_attendance_route(string $action, string $method, array $account): void {
    if ($action === 'attendance_entry' && $method === 'POST') {
        if (!in_array($account['role'], ['admin', 'teacher'], true)) json_response(['error'=>'Administrator or teacher access is required.'],403);
        $config = school_config();
        $attendanceStatuses = $config['attendanceStatuses'] ?? [];
        $schoolDays = (int)($config['schoolDaysPerYear'] ?? 0);
        if ($schoolDays < 1) json_response(['error'=>'School configuration is missing. Import the updated setup.sql file.'],503);
        $input = body_json();
        $studentId = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);
        $date = trim((string)($input['date'] ?? ''));
        $dateObject = DateTime::createFromFormat('!Y-m-d', $date);
        $status = trim((string)($input['status'] ?? ''));
        if ($studentId === false || $studentId === null || !$dateObject || $dateObject->format('Y-m-d') !== $date || !in_array($status, $attendanceStatuses, true)) {
            json_response(['error'=>'Choose a valid student, date and attendance status.'],400);
        }
        $students = store_value('students');
        if (!is_array($students)) json_response(['error'=>'Student records are unavailable.'],500);
        $found = false;
        // Set a safe initial value for static analysis; the matched student's
        // computed attendance replaces it before the response is sent.
        $attendance = 0.0;
        foreach ($students as &$student) {
            if ((int)($student['id'] ?? 0) !== $studentId) continue;
            if ($account['role'] === 'teacher') {
                $sections = store_value('sections');
                if (!is_array($sections)) $sections = [];
                $roll = (string)($student['roll'] ?? '');
                $sectionMatch = preg_match('/^(\d+[A-Z])/i', $roll, $matches);
                $sectionCode = $sectionMatch ? strtoupper($matches[1]) : '';
                $hasAssignedSection = false;
                foreach ($sections as $section) {
                    if (($section['adviserId'] ?? '') === $account['id'] && ($section['code'] ?? '') === $sectionCode && ($section['grade'] ?? '') === ($student['grade'] ?? '')) { $hasAssignedSection = true; break; }
                }
                if (!$hasAssignedSection) json_response(['error'=>'This student is outside your assigned sections.'],403);
            }
            $entries = is_array($student['attendanceEntries'] ?? null) ? $student['attendanceEntries'] : [];
            $previousDayStatus = '';
            $statusPriority = array_flip($attendanceStatuses);
            foreach ($statusPriority as &$priority) $priority++;
            unset($priority);
            $statusPriority['Tardy'] = $statusPriority['Late'] ?? 0;
            foreach ($entries as $oldEntry) {
                if (!is_array($oldEntry) || ($oldEntry['date'] ?? '') !== $date) continue;
                $oldStatus = (string)($oldEntry['status'] ?? '');
                if (($statusPriority[$oldStatus] ?? 0) > ($statusPriority[$previousDayStatus] ?? 0)) $previousDayStatus = $oldStatus;
            }
            $absences = max(0, (int)($student['absences'] ?? 0));
            $lateArrivals = max(0, (int)($student['lateArrivals'] ?? 0));
            if ($previousDayStatus === 'Absent') $absences = max(0, $absences - 1);
            if (in_array($previousDayStatus, ['Tardy', 'Late'], true)) $lateArrivals = max(0, $lateArrivals - 1);
            if ($status === 'Absent') $absences = min($schoolDays, $absences + 1);
            if ($status === 'Late') $lateArrivals++;
            $attendance = round(max(0, ($schoolDays - $absences) / $schoolDays * 100), 1);
            $entries = array_values(array_filter($entries, fn($existing) => !is_array($existing) || ($existing['date'] ?? '') !== $date));
            $entries[] = ['date'=>$date, 'status'=>$status, 'updatedAt'=>date(DATE_ATOM)];
            usort($entries, fn($a,$b) => strcmp((string)($b['date'] ?? ''),(string)($a['date'] ?? '')));
            $student['attendanceEntries'] = array_slice($entries, 0, 730);
            $student['absences'] = $absences;
            $student['lateArrivals'] = $lateArrivals;
            $student['attendance'] = $attendance;
            $updatedStudent = $student;
            $found = true;
            break;
        }
        unset($student);
        if (!$found) json_response(['error'=>'Student record not found.'],404);
        save_value('students', $students);
        $actorRole = $account['role'] === 'teacher' ? 'Teacher' : 'Administrator';
        $actorName = (string)($account['name'] ?? 'School staff');
        $dateLabel = $dateObject->format('M j, Y');
        $studentMessage = 'Your attendance for ' . $dateLabel . ' was marked ' . strtolower($status) . '. Your overall attendance is now ' . number_format($attendance, 1) . '% (' . $absences . ' absences, ' . $lateArrivals . ' late arrivals). Updated by ' . $actorRole . ' ' . $actorName . '.';
        $staffMessage = $actorRole . ' ' . $actorName . ' marked ' . (string)($updatedStudent['name'] ?? 'a student') . "'s attendance for " . $dateLabel . ' as ' . strtolower($status) . '. Overall attendance is now ' . number_format($attendance, 1) . '% (' . $absences . ' absences, ' . $lateArrivals . ' late arrivals).';
        $eventKey = 'attendance-day:' . (string)($updatedStudent['roll'] ?? $studentId) . ':' . $date;
        notify_student_and_adviser($updatedStudent, (string)$account['id'], 'Daily attendance updated', $studentMessage, $staffMessage, 'attendance', $eventKey, $account['role'] === 'teacher');
        json_response(['ok'=>true,'attendance'=>$attendance,'absences'=>$absences,'lateArrivals'=>$lateArrivals,'attendanceEntries'=>$updatedStudent['attendanceEntries']]);
    }
    if ($action === 'attendance' && $method === 'POST') {
        // Define response values at the start of this route so PHP language
        // servers can verify all conditional notification paths safely.
        $attendance = 0.0;
        $updatedStudent = [];
        if (!in_array($account['role'], ['admin', 'teacher'], true)) json_response(['error'=>'Administrator or teacher access is required.'],403);
        $config = school_config();
        $attendanceStatuses = $config['attendanceStatuses'] ?? [];
        $schoolDays = (int)($config['schoolDaysPerYear'] ?? 0);
        if ($schoolDays < 1) json_response(['error'=>'School configuration is missing. Import the updated setup.sql file.'],503);
        $classPeriods = $config['classPeriods'] ?? [];
        $input = body_json();
        $studentId = filter_var($input['id'] ?? null, FILTER_VALIDATE_INT);
        $absences = filter_var($input['absences'] ?? null, FILTER_VALIDATE_INT);
        $lateArrivals = filter_var($input['lateArrivals'] ?? null, FILTER_VALIDATE_INT);
        $entryInput = $input['entry'] ?? null;
        // Initialize optional legacy entry fields so static analyzers can see
        // that later guarded notification code never reads undefined values.
        $entryDate = '';
        $entryDateObject = new DateTimeImmutable('@0');
        $entryPeriod = 0;
        $entrySubject = '';
        $entryStatus = '';
        $entryPeriodLabel = '';
        if ($entryInput !== null) {
            if (!is_array($entryInput)) json_response(['error'=>'The dated attendance details are invalid.'],400);
            $entryDate = trim((string)($entryInput['date'] ?? ''));
            $entryDateObject = DateTime::createFromFormat('!Y-m-d', $entryDate);
            $entryPeriod = filter_var($entryInput['period'] ?? null, FILTER_VALIDATE_INT);
            $entrySubject = trim((string)($entryInput['subject'] ?? ''));
            $entryStatus = trim((string)($entryInput['status'] ?? ''));
            if (!is_array($entryInput) || !$entryDateObject || $entryDateObject->format('Y-m-d') !== $entryDate || $entryPeriod === false || $entryPeriod === null || $entryPeriod < 1 || $entryPeriod > count($classPeriods) || $entrySubject === '' || strlen($entrySubject) > 200 || !in_array($entryStatus, $attendanceStatuses, true)) {
                json_response(['error'=>'Choose a valid date, subject, period and attendance status.'],400);
            }
            $entryPeriodLabel = trim((string)($entryInput['periodLabel'] ?? 'Period ' . $entryPeriod));
            if ($entryPeriodLabel === '') $entryPeriodLabel = 'Period ' . $entryPeriod;
            $entryPeriodLabel = substr($entryPeriodLabel, 0, 80);
        }
        if ($studentId === false || $studentId === null || $absences === false || $absences === null || $absences < 0 || $absences > $schoolDays || $lateArrivals === false || $lateArrivals === null || $lateArrivals < 0) {
            json_response(['error'=>'Absences must be within the configured school year, and late arrivals must be a whole number of 0 or more.'],400);
        }
        $students = store_value('students');
        if (!is_array($students)) json_response(['error'=>'Student records are unavailable.'],500);
        $found = false;
        $attendanceChanged = false;
        foreach ($students as &$student) {
            if ((int)($student['id'] ?? 0) !== $studentId) continue;
            if ($account['role'] === 'teacher') {
                $sections = store_value('sections');
                if (!is_array($sections)) $sections = [];
                $roll = (string)($student['roll'] ?? '');
                $sectionMatch = preg_match('/^(\d+[A-Z])/i', $roll, $matches);
                $sectionCode = $sectionMatch ? strtoupper($matches[1]) : '';
                $hasAssignedSection = false;
                foreach ($sections as $section) {
                    if (($section['adviserId'] ?? '') === $account['id'] && ($section['code'] ?? '') === $sectionCode && ($section['grade'] ?? '') === ($student['grade'] ?? '')) {
                        $hasAssignedSection = true;
                        break;
                    }
                }
                if (!$hasAssignedSection) json_response(['error'=>'This student is outside your assigned sections.'],403);
            }
            $attendanceChanged = (int)($student['absences'] ?? 0) !== $absences || (int)($student['lateArrivals'] ?? 0) !== $lateArrivals || (float)($student['attendance'] ?? 100) !== round(max(0, ($schoolDays - $absences) / $schoolDays * 100), 1);
            $student['absences'] = $absences;
            $student['lateArrivals'] = $lateArrivals;
            $student['attendance'] = round(max(0, ($schoolDays - $absences) / $schoolDays * 100), 1);
            if ($entryInput !== null) {
                $entries = is_array($student['attendanceEntries'] ?? null) ? $student['attendanceEntries'] : [];
                $entry = ['date'=>$entryDate, 'period'=>$entryPeriod, 'periodLabel'=>$entryPeriodLabel, 'subject'=>$entrySubject, 'status'=>$entryStatus, 'updatedAt'=>date(DATE_ATOM)];
                $replaced = false;
                foreach ($entries as $entryIndex => $existingEntry) {
                    if (is_array($existingEntry) && ($existingEntry['date'] ?? '') === $entryDate && (int)($existingEntry['period'] ?? 0) === $entryPeriod) { $entries[$entryIndex] = $entry; $replaced = true; break; }
                }
                if (!$replaced) $entries[] = $entry;
                usort($entries, fn($a,$b) => strcmp((string)($b['date'] ?? ''),(string)($a['date'] ?? '')) ?: ((int)($a['period'] ?? 0) <=> (int)($b['period'] ?? 0)));
                $student['attendanceEntries'] = array_slice($entries, 0, 730);
            }
            $attendance = $student['attendance'];
            $updatedStudent = $student;
            $found = true;
            break;
        }
        unset($student);
        if (!$found) json_response(['error'=>'Student record not found.'],404);
        save_value('students', $students);
        if ($attendanceChanged && $entryInput === null) notify_attendance_change($updatedStudent, (string)$account['id'], (string)($account['name'] ?? 'School staff'), ($account['role'] ?? '') === 'teacher' ? 'Teacher' : 'Administrator', $attendance, $absences, $lateArrivals, $account['role'] === 'teacher');
        if ($entryInput !== null) {
            $actorRole = $account['role'] === 'teacher' ? 'Teacher' : 'Administrator';
            $actorName = (string)($account['name'] ?? 'School staff');
            $dateLabel = $entryDateObject->format('M j, Y');
            $classLabel = $entrySubject . ' (' . $entryPeriodLabel . ')';
            $studentMessage = 'Your ' . $classLabel . ' attendance on ' . $dateLabel . ' was marked ' . strtolower($entryStatus) . '. Overall attendance is ' . number_format($attendance, 1) . '% with ' . $absences . ' absences and ' . $lateArrivals . ' late arrivals. Updated by ' . $actorRole . ' ' . $actorName . '.';
            $staffMessage = $actorRole . ' ' . $actorName . ' marked ' . (string)($updatedStudent['name'] ?? 'a student') . ' ' . $classLabel . ' attendance on ' . $dateLabel . ' as ' . strtolower($entryStatus) . '. Overall attendance: ' . number_format($attendance, 1) . '% (' . $absences . ' absences, ' . $lateArrivals . ' late arrivals).';
            $eventKey = 'attendance-entry:' . (string)($updatedStudent['roll'] ?? $studentId) . ':' . $entryDate . ':' . $entryPeriod;
            notify_student_and_adviser($updatedStudent, (string)$account['id'], 'Class attendance updated', $studentMessage, $staffMessage, 'attendance', $eventKey, $account['role'] === 'teacher');
        }
        json_response(['ok'=>true,'attendance'=>$attendance,'absences'=>$absences,'lateArrivals'=>$lateArrivals,'attendanceEntries'=>$updatedStudent['attendanceEntries'] ?? []]);
    }
}
