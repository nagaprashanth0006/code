#!/bin/bash

# Set Oracle home directory
ORACLE_HOME=/u01/app/oracle/product/19c/dbhome_1

# Set database SID and service name
DB_SID=mydb
SERVICE_NAME=${DB_SID}_service

# Set instance number (if you have multiple instances)
INSTANCE_NUMBER=1

# Set the temporary file location for Oracle
TMP_DIR=/tmp/oracle

# Create a backup of the current parameter file
cp ${ORACLE_HOME}/dbs/init${DB_SID}.ora ${TMP_DIR}/init${DB_SID}_backup.ora

# Update the parameter file with optimal settings
echo "Optimizing database parameters..."

sed -i 's/undo_management=auto/undo_management=BASIC/' ${ORACLE_HOME}/dbs/init${DB_SID}.ora
sed -i 's/db_block_size=8192/db_block_size=16384/' ${ORACLE_HOME}/dbs/init${DB_SID}.ora
sed -i 's/shared_pool_size=200m/shared_pool_size=1024m/' ${ORACLE_HOME}/dbs/init${DB_SID}.ora
sed -i 's/parallel_degree_policy=AUTO/parallel_degree_policy=MANUAL/' ${ORACLE_HOME}/dbs/init${DB_SID}.ora

# Set optimal values for parallel execution parameters
echo "Optimizing parallel execution parameters..."

sed -i 's/parallel_threads_per_cpu=2/parallel_threads_per_cpu=4/' ${ORACLE_HOME}/dbs/init${DB_SID}.ora
sed -i 's/parallel_degree_limit=8/parallel_degree_limit=16/' ${ORACLE_HOME}/dbs/init${DB_SID}.ora

# Set optimal values for OLTP workload parameters
echo "Optimizing OLTP workload parameters..."

sed -i 's/transaction_log_buffer=100m/transaction_log_buffer=200m/' ${ORACLE_HOME}/dbs/init${DB_SID}.ora
sed -i 's/log_buffer=50m/log_buffer=100m/' ${ORACLE_HOME}/dbs/init${DB_SID}.ora

# Set optimal values for instance-specific parameters
echo "Optimizing instance-specific parameters..."

sed -i "s/instance_number=${INSTANCE_NUMBER}/instance_number=${INSTANCE_NUMBER} parallel_degree_policy=MANUAL/" ${ORACLE_HOME}/dbs/init${DB_SID}.ora

# Restart the database with the updated parameter file
echo "Restarting database with optimized settings..."

${ORACLE_HOME}/bin/sqlplus -s / as sysdba @${TMP_DIR}/init${DB_SID}_backup.ora

# Verify that the changes have taken effect
echo "Verifying optimization settings..."

${ORACLE_HOME}/bin/sqlplus -s / as sysdba <<EOF
SET SERVEROUTPUT ON;
SELECT name, value FROM v\$parameter WHERE name LIKE '%parallel_degree_limit%';
SELECT name, value FROM v\$parameter WHERE name LIKE '%transaction_log_buffer%';
EXIT;
EOF

# Clean up temporary files
rm ${TMP_DIR}/init${DB_SID}_backup.ora