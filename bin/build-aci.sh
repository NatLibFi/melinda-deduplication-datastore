#!/bin/bash
set -ex
ACBUILD_CMD="acbuild --no-history"

if [ -z $ACBUILD_ENGINE ];then
  ACBUILD_ENGINE="systemd-nspawn"
fi

ACI_OS="linux"
ACI_ARCH="amd64"
ACI_NAME_DOMAIN="appc.cont-registry-kk.lib.helsinki.fi"
ACI_NAME_GROUP="melinda"
ACI_NAME="deduplication-datastore"
ACI_VERSION="1.0.0"

APP_USER=deduplication
APP_DIRECTORY='/opt/melinda-deduplication-dastastore'
NPM_PACKAGE_NAME=$(grep '"name":' package.json |cut -f2 -d':'|tr -d ',"@ ')
NPM_PACKAGE_LOCAL_NAME=$(echo $NPM_PACKAGE_NAME|cut -f2 -d'/')
NPM_PACKAGE_VERSION=$(grep '"version":' package.json |cut -f2 -d':'|tr -d '," ')
NPM_PACKAGE_FILENAME="$(echo $NPM_PACKAGE_NAME|tr '/' '-')-$NPM_PACKAGE_VERSION.tgz"

rm -rf aci-build;mkdir aci-build
cp $NPM_PACKAGE_FILENAME aci-build

cat <<EOF > aci-build/nodesource.list
deb https://deb.nodesource.com/node_8.x xenial main
deb-src https://deb.nodesource.com/node_8.x xenial main
EOF

cat <<EOF > aci-build/nodesource.pref
Explanation: apt: nodesource
Package: nodejs
Pin: release a=nodesource
Pin-Priority: 1000
EOF

$ACBUILD_CMD begin docker://ubuntu:xenial

$ACBUILD_CMD set-name "$ACI_NAME_DOMAIN/$ACI_NAME_GROUP/$ACI_NAME"
$ACBUILD_CMD label add version $ACI_VERSION
$ACBUILD_CMD label add os $ACI_OS
$ACBUILD_CMD label add arch $ACI_ARCH

$ACBUILD_CMD set-user $APP_USER
$ACBUILD_CMD set-exec -- /bin/bash -c "npx $PACKAGE_NAME 2>&1 | tee -a logs/$NPM_PACKAGE_LOCAL_NAME.log"

$ACBUILD_CMD port add http tcp 80

$ACBUILD_CMD mount add logs $APP_DIRECTORY/logs
$ACBUILD_CMD mount add data $APP_DIRECTORY/data
$ACBUILD_CMD mount add --read-only conf $APP_DIRECTORY/conf

if [ $ACBUILD_ENGINE == 'chroot' ];then
  $ACBUILD_CMD run --engine chroot -- /bin/bash -c "echo '$(grep -m1 -E ^nameserver /etc/resolv.conf)' > /etc/resolv.conf"
fi

$ACBUILD_CMD run --engine $ACBUILD_ENGINE -- /bin/bash -c "useradd -rm -s /bin/bash -d $APP_DIRECTORY $APP_USER"

$ACBUILD_CMD copy-to-dir aci-build/$NPM_PACKAGE_FILENAME $APP_DIRECTORY

$ACBUILD_CMD run --engine $ACBUILD_ENGINE -- ln -fs /usr/share/zoneinfo/Europe/Helsinki /etc/localtime
$ACBUILD_CMD run --engine $ACBUILD_ENGINE -- /bin/bash -c 'apt-get -y update && apt-get -y install apt-transport-https curl git tzdata'

$ACBUILD_CMD copy aci-build/nodesource.list /etc/apt/sources.list.d/nodesource.list 
$ACBUILD_CMD copy aci-build/nodesource.pref /etc/apt/preferences.d/nodesource.pref

$ACBUILD_CMD run --engine $ACBUILD_ENGINE -- /bin/bash -c 'curl -s https://deb.nodesource.com/gpgkey/nodesource.gpg.key | apt-key add -'
$ACBUILD_CMD run --engine $ACBUILD_ENGINE -- /bin/bash -c 'apt-get -y update && apt-get -y install nodejs'
$ACBUILD_CMD run --engine $ACBUILD_ENGINE --working-dir $APP_DIRECTORY -- /bin/bash -c "npm install --production $NPM_PACKAGE_FILENAME"
$ACBUILD_CMD run --engine $ACBUILD_ENGINE --working-dir $APP_DIRECTORY -- /bin/bash -c "chown -R $APP_USER * && chmod -R o+rx *"

if [ $ACBUILD_ENGINE == 'chroot' ];then
  $ACBUILD_CMD run --engine chroot -- rm /etc/resolv.conf
fi

$ACBUILD_CMD write --overwrite "aci-build/$ACI_NAME_GROUP-$ACI_NAME-$ACI_OS-$ACI_ARCH-$ACI_VERSION.aci"
$ACBUILD_CMD end

chmod og+rx aci-build
