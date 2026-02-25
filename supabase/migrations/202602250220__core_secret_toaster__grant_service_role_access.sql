-- Ensure local/hosted service_role can access app schemas used by edge functions.

grant usage on schema core to service_role;
grant usage on schema secret_toaster to service_role;

grant all privileges on all tables in schema core to service_role;
grant all privileges on all tables in schema secret_toaster to service_role;

grant all privileges on all sequences in schema core to service_role;
grant all privileges on all sequences in schema secret_toaster to service_role;

alter default privileges in schema core
grant all privileges on tables to service_role;

alter default privileges in schema secret_toaster
grant all privileges on tables to service_role;

alter default privileges in schema core
grant all privileges on sequences to service_role;

alter default privileges in schema secret_toaster
grant all privileges on sequences to service_role;
