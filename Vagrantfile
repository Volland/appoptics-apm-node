require 'json'

#
# This Vagrantfile builds a dev box with all the parts needed for testing
#
$script = <<-BASH

#
# gcc 4.8.4 failed GLIBCXX_3.4.21 not found
#
sudo add-apt-repository ppa:ubuntu-toolchain-r/test
sudo apt-get -y update

sudo apt-get -y install gcc-4.9 g++-4.9
sudo apt-get -y install software-properties-common python-software-properties \
  build-essential curl git wget unzip libpq-dev libkrb5-dev

# tracelyzer and liboboe
#[ao]wget https://files.tv.solarwinds.com/install_traceview.sh
#[ao]sudo sh ./install_traceview.sh f08da708-7f1c-4935-ae2e-122caf1ebe31
sudo sh /appoptics/install-appoptics-daemon.sh f08da708-7f1c-4935-ae2e-122caf1ebe31
# the code requires an environment variable now.
export APPOPTICS_SERVICE_KEY=f08da708-7f1c-4935-ae2e-122caf1ebe31

# node/nvm
curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.29.0/install.sh | bash
echo 'if [[ ":$PATH:" != *":node_modules/.bin:"* ]]; then PATH=${PATH}:node_modules/.bin; fi' >> $HOME/.bashrc
source $HOME/.nvm/nvm.sh
nvm install 4.7
nvm alias default 4.7

# needs oracle's libclntsh.so package
# https://github.com/oracle/node-oracledb/blob/master/INSTALL.md#instzip
# and LD_LIBRARY_PATH set to include destination (/opt/oracle/instantclient)
BASH

$exports = <<-BASH
cat <<EOF >> $HOME/.bashrc
export TEST_MONGODB_2_4=127.0.0.1:27017
export TEST_MONGODB_2_6=127.0.0.1:27018
export TEST_MONGODB_3_0=127.0.0.1:27019
export TEST_MONGODB_SET=127.0.0.1:27020,127.0.0.1:27021,127.0.0.1:27022
export TEST_CASSANDRA_2_2=127.0.0.1:9042
export TEST_REDIS_3_0=127.0.0.1:6379
export TEST_MEMCACHED_1_4=127.0.0.1:11211
export TEST_RABBITMQ_3_5=127.0.0.1:5672
export TEST_ORACLE=127.0.0.1:1521
export TEST_ORACLE_DBNAME=xe
export TEST_ORACLE_USERNAME=system
export TEST_ORACLE_PASSWORD=oracle
export TEST_MYSQL=127.0.0.1:3306
export TEST_MYSQL_USERNAME=
export TEST_MYSQL_PASSWORD=
export TEST_POSTGRES=127.0.0.1:5432
export TEST_POSTGRES_USERNAME=postgres
export TEST_POSTGRES_PASSWORD=
export TEST_SQLSERVER_EX=127.0.0.1:1433
export TEST_SQLSERVER_EX_USERNAME=sa
export TEST_SQLSERVER_EX_PASSWORD=

# env vars to enable fetch from private github repos. if all are empty
# the install-appoptics-bindings script attempts to install from npm's
# public repository for node-appoptics-bindings.

# this is the github repository#branch to fetch from
export AO_TEST_PACKAGE=librato/node-appoptics-bindings.git#single-step-install
# this is an authorization token generated by github
export AO_TEST_GITAUTH=52eb381ad0f519d4af21bf396175268c135591d0
# alternatively you can authenticate with a github username and password
# they will only be used if they are both not empty
export AO_TEST_GITUSER=
export AO_TEST_GITPASS=

EOF
BASH

Vagrant.configure(2) do |config|
  #config.vm.box = 'ubuntu/trusty64'
  config.vm.box = 'bento/ubuntu-16.04'

  config.vm.network 'private_network', type: 'dhcp'
  config.vm.synced_folder '.', '/vagrant', id: 'core', nfs: true
  config.vm.synced_folder '../artifacts', '/appoptics', nfs: true
  config.vm.synced_folder '../ao-bindings', '/ao-bindings', nfs: true

  config.vm.provision 'docker' do |d|
    images = JSON.parse(File.read('docker-containers.json'), symbolize_names: true)
    images.each do |image|
      # Determine name
      name = image[:name]

      # Determine image
      tagged = image[:image].nil? ? name : image[:image]
      tagged += ':' + image[:tag] unless image[:tag].nil?
      d.pull_images tagged

      # Determine base args
      args = (image[:args] || '') + ' '

      # Add port settings
      args += image[:ports].map do |port|
        port.is_a?(Array) ? " -p #{port[0]}:#{port[1]}" : " -p #{port}:#{port}"
      end.join ''

      # Add env settings
      unless image[:env].nil?
        args += image[:env].map { |k, v| " -e #{k}=#{v}" }.join ''
      end

      # Run container
      d.run name, image: tagged, args: args
    end
  end

  config.vm.provision 'shell', privileged: false, inline: $script
  config.vm.provision 'shell', privileged: false, inline: $exports

  # Virtualbox VM
  config.vm.provider :virtualbox do |provider|
    # Cap cpu and memory usage
    provider.customize [
      'modifyvm', :id,
      '--memory', 4096,
      '--cpuexecutioncap', 100
    ]

    # Enable symlink support
    provider.customize [
      'setextradata', :id,
      'VBoxInternal2/SharedFoldersEnableSymlinksCreate/v-root', '1'
    ]
  end
end
