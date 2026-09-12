set :stage, :staging
set :branch, 'dev'
set :app_env, 'staging'

set :application, 'mtc_api'
set :full_app_name, -> { "#{fetch(:application)}_#{fetch(:stage)}" }
set :deploy_user, 'app'
set :deploy_to, -> { "/home/#{fetch(:deploy_user)}/www/mtc/#{fetch(:full_app_name)}" }

# change to your application domain name
set :server_name, 'api-mtc.glife.dev'
set :server_port, 30_044

# server '18.136.123.226', user: 'app', roles: %i[app], primary: true
server '34.87.160.246', user: 'app', roles: %i[app], primary: true

set :ssh_options, { forward_agent: true }

# for NVM
set :nvm_type, :user
set :nvm_node, File.exist?('.nvmrc') && File.read('.nvmrc').strip
set :nvm_map_bins, %w[nvm node npm pm2 yarn]
set :nvm_custom_path, -> { "/home/#{fetch(:deploy_user)}/.nvm/versions/node" }
set :default_env, lambda {
  {
    'PATH' => "/home/#{fetch(:deploy_user)}/.nvm/versions/node/#{fetch(:nvm_node)}/bin:$PATH"
  }
}
set :nvm_path, -> { "/home/#{fetch(:deploy_user)}/.nvm" }

set :env_vars, lambda {
  {
    'NAME' => 'CRM MTC',
    'API_HOST' => 'https://api-mtc.glife.dev',
    'DOMAIN_NAME' => 'api-mtc.glife.dev',
    'FRONTEND_URL' => 'https://mtc.glife.dev',
    'DASHBOARD_URL' => 'https://admin-mtc.glife.dev',
    'EMAIL_SUPPORT' => 'noreply@glife.dev'
  }
}
