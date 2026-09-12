set :keep_releases, 5

# change to your git address
set :repo_url, 'git@github.com:jobsify/crm_backend.git'

# share folders
set :linked_dirs, %w[tmp log pst_data pst_out]
set :linked_files, %w[.env app.json nginx.conf]

# pm2 tasks
namespace :pm2 do
  desc 'List pm2 apps'
  task :ls do
    on roles(:app) do
      execute :pm2, 'ls'
    end
  end

  desc 'Show pm2 app, cap staging pm2:show app=test'
  task :show do
    on roles(:app) do
      execute :pm2, "show #{ENV['app']}"
    end
  end

  desc 'Save pm2 app, cap staging pm2:save'
  task :save do
    on roles(:app) do
      execute :pm2, 'save'
    end
  end
end

# app tasks
namespace :app do
  desc 'Build app'
  task :build do
    on roles(:app, :bg) do
      within release_path do
        execute :yarn, 'install'
        execute :yarn, 'build'
      end
    end
  end

  desc 'Start app'
  task :start do
    on roles(:app) do
      within shared_path do
        execute :pm2, 'start app.json'
        execute :pm2, 'save'
      end
    end
  end

  desc 'Stop app'
  task :stop do
    on roles(:app) do
      within shared_path do
        execute :pm2, 'stop app.json'
        execute :pm2, 'save'
      end
    end
  end

  desc 'Reload app'
  task :reload do
    on roles(:app) do
      within shared_path do
        execute :pm2, 'reload app.json'
        execute :pm2, 'save'
      end
    end
  end

  desc 'Restart app'
  task :restart do
    on roles(:app) do
      within shared_path do
        execute :pm2, 'restart app.json --update-env'
        execute :pm2, 'save'
      end
    end
  end
end

# bg tasks
namespace :bg do
  desc 'Start bg'
  task :start do
    on roles(:bg) do
      within shared_path do
        execute :pm2, 'start worker.json'
        execute :pm2, 'save'
      end
    end
  end

  desc 'Stop bg'
  task :stop do
    on roles(:bg) do
      within shared_path do
        execute :pm2, 'stop worker.json'
        execute :pm2, 'save'
      end
    end
  end

  desc 'Reload bg'
  task :reload do
    on roles(:bg) do
      within shared_path do
        execute :pm2, 'reload worker.json'
        execute :pm2, 'save'
      end
    end
  end

  desc 'Restart bg'
  task :restart do
    on roles(:bg) do
      within shared_path do
        execute :pm2, 'restart worker.json --update-env'
        execute :pm2, 'save'
      end
    end
  end
end

namespace :deploy do
  before 'deploy:publishing', 'app:build'
  after 'deploy:publishing', 'deploy:phased_restart'

  task :phased_restart do
    invoke 'app:reload'
    invoke 'bg:reload'
  end

  task :restart do
    invoke 'app:restart'
    invoke 'bg:restart'
  end

  task :start do
    invoke 'app:start'
    invoke 'bg:start'
  end

  task :stop do
    invoke 'app:stop'
    invoke 'bg:stop'
  end

  desc 'Upload config files'
  task :upload_config do
    on roles(%i[app]) do
      within shared_path do
        app_config = ERB.new(File.read("#{stage_config_path}/templates/app.json.erb")).result(binding)
        env_config = ERB.new(File.read("#{stage_config_path}/templates/.env.erb")).result(binding)
        nginx_config = ERB.new(File.read("#{stage_config_path}/templates/nginx.conf.erb")).result(binding)

        upload! StringIO.new(app_config), "#{shared_path}/app.json"
        upload! StringIO.new(env_config), "#{shared_path}/.env"
        upload! StringIO.new(nginx_config), "#{shared_path}/nginx.conf"
      end
    end
    on roles(%i[bg]) do
      within shared_path do
        worker_config = ERB.new(File.read("#{stage_config_path}/templates/worker.json.erb")).result(binding)
        upload! StringIO.new(worker_config), "#{shared_path}/worker.json"
      end
    end
  end

  desc 'Runs any yarn command task, cap deploy:yarn task=db:index'
  task :yarn do
    on roles(:app) do
      within release_path do
        execute :yarn, ENV['task']
      end
    end
  end
end

# nginx tasks
namespace :nginx do
  desc 'Enable nginx'
  task :enable do
    on roles(:app) do
      execute %(sudo ln -nfs #{shared_path}/nginx.conf /etc/nginx/sites-enabled/#{fetch(:server_name)})
      execute %(sudo service nginx restart)
    end
  end

  desc 'Disable nginx'
  task :disable do
    on roles(:app) do
      execute %(sudo rm -rf /etc/nginx/sites-enabled/#{fetch(:server_name)})
      execute %(sudo service nginx restart)
    end
  end
end

# nvm tasks
namespace :nvm do
  desc 'Install node'
  task install: :'nvm:wrapper' do
    on release_roles(fetch(:nvm_roles)) do
      execute "source \"#{fetch(:nvm_path)}/nvm.sh\" && nvm install #{fetch(:nvm_node)} && nvm use #{fetch(:nvm_node)} && npm install -g yarn pm2"
    end
  end

  desc 'Remove node'
  task remove: :'nvm:wrapper' do
    on release_roles(fetch(:nvm_roles)) do
      execute "source \"#{fetch(:nvm_path)}/nvm.sh\" && nvm remove #{fetch(:nvm_node)}"
    end
  end
end

Rake::Task['nvm:validate'].clear_actions
