SCHOLIX — XAMPP SETUP AND USER GUIDE
====================================

ABOUT SCHOLIX
-------------
Scholix is a PHP and MySQL school-record dashboard for administrators, teachers and students. It brings a searchable student roster, attendance, grades, fee status, schedules and school-document requirements together.

The supplied database has three demo accounts and 26 sample student records. Replace sample information before using real student data.

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

REQUIREMENTS
------------
- Windows with XAMPP (Apache, MariaDB/MySQL, PHP and phpMyAdmin) and a modern browser.
- Apache and MySQL/MariaDB must be running while using Scholix.
- PHP PDO MySQL and Fileinfo extensions should be enabled; XAMPP normally includes them.
- PHP upload limits should permit documents up to 10 MB. In php.ini, values such as upload_max_filesize = 10M and post_max_size = 12M are suitable. Restart Apache after changing php.ini.

XAMPP INSTALLATION
------------------
Step 1 — Place the project
1. Back up any existing Scholix folder before replacing files.
2. Put the complete project folder at C:\xampp\htdocs\Scholix\.
3. Confirm that api.php, config.php, setup.sql and the html, js, css, assets and uploads folders are present.

Step 2 — Start XAMPP
1. Open the XAMPP Control Panel.
2. Start Apache and MySQL and wait until both show as running/green.
3. If MySQL stops, open its Logs button and review the MySQL error log. A port conflict (often 3306) or damaged database files can prevent startup. Back up database files before recovery; do not delete the MySQL data folder as a first step.

Step 3 — Import the database (first-time setup)
1. With Apache and MySQL running, open http://localhost/phpmyadmin/.
2. Select Import.
3. Choose C:\xampp\htdocs\Scholix\setup.sql.
4. Start the import and wait for the success message.
5. setup.sql creates the scholix database, users and app_data tables, three demo accounts and the sample roster.
Import setup.sql for a first-time installation. For an existing database, export a backup first; do not re-import just to start the application.

Step 4 — Check the database connection
Open C:\xampp\htdocs\Scholix\config.php. Default local settings:
- Host: 127.0.0.1
- Database: scholix
- User: root
- Password: blank
If your MySQL root account uses a password or a different port, update the matching config.php values.

Step 5 — Open Scholix
- Home: http://localhost/Scholix/
- Sign in: http://localhost/Scholix/html/login.php

ACCOUNTS
-------------
Administrator: admin@scholix.com / admin123
Teacher: teacher@scholix.com / teacher123
Student: student@scholix.com / student123
The student account is linked to Aarav Mehta, roll 6A-001.

These are initial credentials from setup.sql. If an account's email or password was changed in Settings, use the new credentials.

DATABASE AND FILE STORAGE
-------------------------
- Database: scholix.
- users stores login emails, roles, account details and password hashes.
- app_data stores the roster, sections and profile data as JSON payloads.
- Uploaded requirement documents live under C:\xampp\htdocs\Scholix\uploads\requirements\. The database stores their related metadata. A database export does not include uploaded files; include uploads in backups.
- Profile pictures are stored with profile data in MySQL.
- Apache/PHP must be able to write to uploads when a student submits a document.

BACK UP YOUR WORK
-----------------
1. In phpMyAdmin, select the scholix database and choose Export. Save the SQL export outside the XAMPP folder.
2. Copy the Scholix project folder, including uploads, to a separate backup location.
3. Keep dated copies; store at least one copy outside the computer if the data matters.
setup.sql is an initializer, not a backup of changes made while using Scholix.

TROUBLESHOOTING
---------------
Apache will not start
- Check for another program using ports 80 or 443. Use XAMPP Logs and Netstat to investigate.

MySQL will not start
- Check MySQL Logs and confirm port 3306 is free.
- Close other MySQL/MariaDB services using that port.
- Do not repeatedly force-start MySQL or delete/replace files in mysql\data without a separate backup.

Scholix cannot connect to the database
- Confirm Apache and MySQL are running.
- Check database name, user, password and host in config.php.
- Confirm setup.sql was imported into scholix.

Login fails
- Use the correct account email and current password. Initial demo passwords stop working after they are changed.
- Manually changing a database password hash will not set a usable password unless it is generated correctly.

Document upload fails
- Confirm Apache can write to uploads/requirements.
- Confirm the file is 10 MB or smaller and PHP upload limits are high enough.

Code changes do not appear
- Press Ctrl+F5 to reload JavaScript and styles.
- Confirm the edited file is in C:\xampp\htdocs\Scholix\, not just in Downloads or another copy.

phpMyAdmin is slow or stuck
- Confirm MySQL is running and check its error log. Clearing browser cache will not fix a MySQL startup problem or database corruption.