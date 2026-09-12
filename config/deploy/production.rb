set :stage, :production
set :branch, 'master'
set :deploy_user, 'app'

set :application, 'jobsify'
set :full_app_name, -> { "#{fetch(:application)}_#{fetch(:stage)}" }
set :server_name, 'api-ams.mtcconsulting.com.sg' # change to your application domain name
set :server_port, 30044

server '172.104.35.75', user: 'app', roles: ['app'], primary: true # change to your server IP and your username

set :deploy_to, -> { "/home/#{fetch(:deploy_user)}/www/#{fetch(:full_app_name)}" }

# for NVM
set :nvm_type, :user
set :nvm_node, File.exist?('.nvmrc') && File.read('.nvmrc').strip || 'v12.21.0'
set :nvm_map_bins, %w[node npm yarn pm2]
set :nvm_custom_path, "/home/#{fetch(:deploy_user)}/.nvm/versions/node"
set :default_env,
    'PATH' => "/home/#{fetch(:deploy_user)}/.nvm/versions/node/#{fetch(:nvm_node)}/bin:$PATH"
set :nvm_path, "/home/#{fetch(:deploy_user)}/.nvm"

set :ssh_options, { forward_agent: true }
