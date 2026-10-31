SCHOLIX — XAMPP SETUP AND USER GUIDE
====================================

ABOUT SCHOLIX
-------------
Scholix is a PHP and MySQL school-record dashboard for administrators, teachers and students. It brings a searchable student roster, attendance, grades, fee status, schedules and school-document requirements together.

The supplied database has three demo accounts and 26 sample student records. Replace sample information before using real student data.

ACCOUNTS
--------
Administrator: admin@scholix.com / admin123

Teacher: teacher@scholix.com / teacher123

Student: student@scholix.com / student123

The student account is linked to Aarav Mehta, roll 6A-001.

These are initial credentials from setup.sql. If an account's email or password was changed in Settings, use the new credentials.

FEATURES BY ACCOUNT
-------------------
Administrator
- View/search/filter the full roster and open individual student details.
- Add, edit and delete student records.
- Review attendance, fees and outstanding amounts.
- Manage class sections, rooms, grades and advisers.
- Review document requirements, inspect uploads, set verification statuses and leave student notes.
- View staff/account information and school reports.
- Export the filtered roster to CSV.
- Edit the administrator's own profile, email, picture and password.

Teacher
- View students in the account's assigned grades. The supplied account covers Grades 7 and 8.
- Update attendance, absences and late arrivals for students in scope.
- View student details, schedules and grade reports.
- View fee status; fee amounts are hidden.
- Edit the teacher's own profile, email, picture and password.

Student
- View only the student record linked to the account. The supplied account is linked to roll 6A-001.
- View personal/guardian details, attendance, grades, fee status, schedule and requirement progress.
- Upload or replace required documents for office review.
- Edit the student's own profile, email, picture and password. Profile changes update the linked student record.

Password changes require the current password, a new password of at least 8 characters and a matching confirmation. Use Save profile to submit profile and password changes. Leave all password fields blank to keep the current password.

SCHOLIX URL
-----------
- Home: http://localhost/Scholix/
- Sign in: http://localhost/Scholix/html/login.php
