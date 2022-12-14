import * as WebIFC from 'web-ifc';
import { IFCSPACE, IFCOPENINGELEMENT, IFCPRODUCTDEFINITIONSHAPE, IFCRELAGGREGATES, IFCRELCONTAINEDINSPATIALSTRUCTURE, IFCRELDEFINESBYPROPERTIES, IFCRELASSOCIATESMATERIAL, IFCRELDEFINESBYTYPE, IFCPROJECT, IFCBUILDING, IFCFURNISHINGELEMENT, IFCWINDOW, IFCDOOR } from 'web-ifc';
import { Mesh, Color as Color$1, MeshLambertMaterial, DoubleSide, Matrix4, BufferGeometry, BufferAttribute as BufferAttribute$1, PropertyBinding, InterpolateLinear, Vector3 as Vector3$1, RGBAFormat, RGBFormat, MathUtils, InterpolateDiscrete, Scene, NearestFilter, NearestMipmapNearestFilter, NearestMipmapLinearFilter, LinearFilter, LinearMipmapNearestFilter, LinearMipmapLinearFilter, ClampToEdgeWrapping, RepeatWrapping, MirroredRepeatWrapping, InstancedMesh, Loader, FileLoader } from 'three';
import { mergeBufferGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

const nullIfcManagerErrorMessage = 'IfcManager is null!';

class IFCModel extends Mesh {

  constructor() {
    super(...arguments);
    this.modelID = IFCModel.modelIdCounter++;
    this.ifcManager = null;
    this.mesh = this;
  }

  static dispose() {
    IFCModel.modelIdCounter = 0;
  }

  setIFCManager(manager) {
    this.ifcManager = manager;
  }

  setWasmPath(path) {
    if (this.ifcManager === null)
      throw new Error(nullIfcManagerErrorMessage);
    this.ifcManager.setWasmPath(path);
  }

  close(scene) {
    if (this.ifcManager === null)
      throw new Error(nullIfcManagerErrorMessage);
    this.ifcManager.close(this.modelID, scene);
  }

  getExpressId(geometry, faceIndex) {
    if (this.ifcManager === null)
      throw new Error(nullIfcManagerErrorMessage);
    return this.ifcManager.getExpressId(geometry, faceIndex);
  }

  getAllItemsOfType(type, verbose) {
    if (this.ifcManager === null)
      throw new Error(nullIfcManagerErrorMessage);
    return this.ifcManager.getAllItemsOfType(this.modelID, type, verbose);
  }

  getItemProperties(id, recursive = false) {
    if (this.ifcManager === null)
      throw new Error(nullIfcManagerErrorMessage);
    return this.ifcManager.getItemProperties(this.modelID, id, recursive);
  }

  getPropertySets(id, recursive = false) {
    if (this.ifcManager === null)
      throw new Error(nullIfcManagerErrorMessage);
    return this.ifcManager.getPropertySets(this.modelID, id, recursive);
  }

  getTypeProperties(id, recursive = false) {
    if (this.ifcManager === null)
      throw new Error(nullIfcManagerErrorMessage);
    return this.ifcManager.getTypeProperties(this.modelID, id, recursive);
  }

  getIfcType(id) {
    if (this.ifcManager === null)
      throw new Error(nullIfcManagerErrorMessage);
    return this.ifcManager.getIfcType(this.modelID, id);
  }

  getSpatialStructure() {
    if (this.ifcManager === null)
      throw new Error(nullIfcManagerErrorMessage);
    return this.ifcManager.getSpatialStructure(this.modelID);
  }

  getSubset(material) {
    if (this.ifcManager === null)
      throw new Error(nullIfcManagerErrorMessage);
    return this.ifcManager.getSubset(this.modelID, material);
  }

  removeSubset(material, customID) {
    if (this.ifcManager === null)
      throw new Error(nullIfcManagerErrorMessage);
    this.ifcManager.removeSubset(this.modelID, material, customID);
  }

  createSubset(config) {
    if (this.ifcManager === null)
      throw new Error(nullIfcManagerErrorMessage);
    const modelConfig = {
      ...config,
      modelID: this.modelID
    };
    return this.ifcManager.createSubset(modelConfig);
  }

}

IFCModel.modelIdCounter = 0;

class IFCParser {

  constructor(state, BVH) {
    this.state = state;
    this.BVH = BVH;
    this.loadedModels = 0;
    this.optionalCategories = {
      [IFCSPACE]: true,
      [IFCOPENINGELEMENT]: false
    };
    this.geometriesByMaterials = {};
    this.loadingState = {
      total: 0,
      current: 0,
      step: 0.1
    };
    this.currentWebIfcID = -1;
    this.currentModelID = -1;
  }

  async setupOptionalCategories(config) {
    this.optionalCategories = config;
  }

  async parse(buffer, coordinationMatrix) {
    if (this.state.api.wasmModule === undefined)
      await this.state.api.Init();
    await this.newIfcModel(buffer);
    this.loadedModels++;
    if (coordinationMatrix) {
      await this.state.api.SetGeometryTransformation(this.currentWebIfcID, coordinationMatrix);
    }
    return this.loadAllGeometry(this.currentWebIfcID);
  }

  getAndClearErrors(_modelId) {}

  notifyProgress(loaded, total) {
    if (this.state.onProgress)
      this.state.onProgress({
        loaded,
        total
      });
  }

  async newIfcModel(buffer) {
    const data = new Uint8Array(buffer);
    this.currentWebIfcID = await this.state.api.OpenModel(data, this.state.webIfcSettings);
    this.currentModelID = this.state.useJSON ? this.loadedModels : this.currentWebIfcID;
    this.state.models[this.currentModelID] = {
      modelID: this.currentModelID,
      mesh: {},
      types: {},
      jsonData: {}
    };
  }

  async loadAllGeometry(modelID) {
    this.addOptionalCategories(modelID);
    await this.initializeLoadingState(modelID);
    this.state.api.StreamAllMeshes(modelID, (mesh) => {
      this.updateLoadingState();
      this.streamMesh(modelID, mesh);
    });
    this.notifyLoadingEnded();
    const geometries = [];
    const materials = [];
    Object.keys(this.geometriesByMaterials).forEach((key) => {
      const geometriesByMaterial = this.geometriesByMaterials[key].geometries;
      const merged = mergeBufferGeometries(geometriesByMaterial);
      materials.push(this.geometriesByMaterials[key].material);
      geometries.push(merged);
    });
    const combinedGeometry = mergeBufferGeometries(geometries, true);
    this.cleanUpGeometryMemory(geometries);
    if (this.BVH)
      this.BVH.applyThreeMeshBVH(combinedGeometry);
    const model = new IFCModel(combinedGeometry, materials);
    this.state.models[this.currentModelID].mesh = model;
    return model;
  }

  async initializeLoadingState(modelID) {
    const shapes = await this.state.api.GetLineIDsWithType(modelID, IFCPRODUCTDEFINITIONSHAPE);
    this.loadingState.total = shapes.size();
    this.loadingState.current = 0;
    this.loadingState.step = 0.1;
  }

  notifyLoadingEnded() {
    this.notifyProgress(this.loadingState.total, this.loadingState.total);
  }

  updateLoadingState() {
    const realCurrentItem = Math.min(this.loadingState.current++, this.loadingState.total);
    if (realCurrentItem / this.loadingState.total >= this.loadingState.step) {
      const currentProgress = Math.ceil(this.loadingState.total * this.loadingState.step);
      this.notifyProgress(currentProgress, this.loadingState.total);
      this.loadingState.step += 0.1;
    }
  }

  addOptionalCategories(modelID) {
    const optionalTypes = [];
    for (let key in this.optionalCategories) {
      if (this.optionalCategories.hasOwnProperty(key)) {
        const category = parseInt(key);
        if (this.optionalCategories[category])
          optionalTypes.push(category);
      }
    }
    this.state.api.StreamAllMeshesWithTypes(this.currentWebIfcID, optionalTypes, (mesh) => {
      this.streamMesh(modelID, mesh);
    });
  }

  streamMesh(modelID, mesh) {
    const placedGeometries = mesh.geometries;
    const size = placedGeometries.size();
    for (let i = 0; i < size; i++) {
      const placedGeometry = placedGeometries.get(i);
      let itemMesh = this.getPlacedGeometry(modelID, mesh.expressID, placedGeometry);
      let geom = itemMesh.geometry.applyMatrix4(itemMesh.matrix);
      this.storeGeometryByMaterial(placedGeometry.color, geom);
    }
  }

  getPlacedGeometry(modelID, expressID, placedGeometry) {
    const geometry = this.getBufferGeometry(modelID, expressID, placedGeometry);
    const mesh = new Mesh(geometry);
    mesh.matrix = this.getMeshMatrix(placedGeometry.flatTransformation);
    mesh.matrixAutoUpdate = false;
    return mesh;
  }

  getBufferGeometry(modelID, expressID, placedGeometry) {
    const geometry = this.state.api.GetGeometry(modelID, placedGeometry.geometryExpressID);
    const verts = this.state.api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
    const indices = this.state.api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
    const buffer = this.ifcGeometryToBuffer(expressID, verts, indices);
    geometry.delete();
    return buffer;
  }

  storeGeometryByMaterial(color, geometry) {
    let colID = `${color.x}${color.y}${color.z}${color.w}`;
    if (this.geometriesByMaterials[colID]) {
      this.geometriesByMaterials[colID].geometries.push(geometry);
      return;
    }
    const col = new Color$1(color.x, color.y, color.z);
    const material = new MeshLambertMaterial({
      color: col,
      side: DoubleSide
    });
    material.transparent = color.w !== 1;
    if (material.transparent)
      material.opacity = color.w;
    this.geometriesByMaterials[colID] = {
      material,
      geometries: [geometry]
    };
  }

  getMeshMatrix(matrix) {
    const mat = new Matrix4();
    mat.fromArray(matrix);
    return mat;
  }

  ifcGeometryToBuffer(expressID, vertexData, indexData) {
    const geometry = new BufferGeometry();
    const posFloats = new Float32Array(vertexData.length / 2);
    const normFloats = new Float32Array(vertexData.length / 2);
    const idAttribute = new Uint32Array(vertexData.length / 6);
    for (let i = 0; i < vertexData.length; i += 6) {
      posFloats[i / 2] = vertexData[i];
      posFloats[i / 2 + 1] = vertexData[i + 1];
      posFloats[i / 2 + 2] = vertexData[i + 2];
      normFloats[i / 2] = vertexData[i + 3];
      normFloats[i / 2 + 1] = vertexData[i + 4];
      normFloats[i / 2 + 2] = vertexData[i + 5];
      idAttribute[i / 6] = expressID;
    }
    geometry.setAttribute('position', new BufferAttribute$1(posFloats, 3));
    geometry.setAttribute('normal', new BufferAttribute$1(normFloats, 3));
    geometry.setAttribute('expressID', new BufferAttribute$1(idAttribute, 1));
    geometry.setIndex(new BufferAttribute$1(indexData, 1));
    return geometry;
  }

  cleanUpGeometryMemory(geometries) {
    geometries.forEach(geometry => geometry.dispose());
    Object.keys(this.geometriesByMaterials).forEach((materialID) => {
      const geometriesByMaterial = this.geometriesByMaterials[materialID];
      geometriesByMaterial.geometries.forEach(geometry => geometry.dispose());
      geometriesByMaterial.geometries = [];
      geometriesByMaterial.material = null;
    });
    this.geometriesByMaterials = {};
  }

}

class ItemsMap {

  constructor(state) {
    this.state = state;
    this.map = {};
  }

  generateGeometryIndexMap(modelID) {
    if (this.map[modelID])
      return;
    const geometry = this.getGeometry(modelID);
    const items = this.newItemsMap(modelID, geometry);
    for (const group of geometry.groups) {
      this.fillItemsWithGroupInfo(group, geometry, items);
    }
  }

  getSubsetID(modelID, material, customID = 'DEFAULT') {
    const baseID = modelID;
    const materialID = material ? material.uuid : 'DEFAULT';
    return `${baseID} - ${materialID} - ${customID}`;
  }

  dispose() {
    Object.values(this.map).forEach(model => {
      model.indexCache = null;
      model.map = null;
    });
    this.map = null;
  }

  getGeometry(modelID) {
    const geometry = this.state.models[modelID].mesh.geometry;
    if (!geometry)
      throw new Error('Model without geometry.');
    if (!geometry.index)
      throw new Error('Geometry must be indexed');
    return geometry;
  }

  newItemsMap(modelID, geometry) {
    const startIndices = geometry.index.array;
    this.map[modelID] = {
      indexCache: startIndices.slice(0, geometry.index.array.length),
      map: new Map()
    };
    return this.map[modelID];
  }

  fillItemsWithGroupInfo(group, geometry, items) {
    let prevExpressID = -1;
    const materialIndex = group.materialIndex;
    const materialStart = group.start;
    const materialEnd = materialStart + group.count - 1;
    let objectStart = -1;
    let objectEnd = -1;
    for (let i = materialStart; i <= materialEnd; i++) {
      const index = geometry.index.array[i];
      const expressID = geometry.attributes.expressID.array[index];
      if (prevExpressID === -1) {
        prevExpressID = expressID;
        objectStart = i;
      }
      const isEndOfMaterial = i === materialEnd;
      if (isEndOfMaterial) {
        const store = this.getMaterialStore(items.map, expressID, materialIndex);
        store.push(objectStart, materialEnd);
        break;
      }
      if (prevExpressID === expressID)
        continue;
      const store = this.getMaterialStore(items.map, prevExpressID, materialIndex);
      objectEnd = i - 1;
      store.push(objectStart, objectEnd);
      prevExpressID = expressID;
      objectStart = i;
    }
  }

  getMaterialStore(map, id, matIndex) {
    if (map.get(id) === undefined) {
      map.set(id, {});
    }
    const storedIfcItem = map.get(id);
    if (storedIfcItem === undefined)
      throw new Error('Geometry map generation error');
    if (storedIfcItem[matIndex] === undefined) {
      storedIfcItem[matIndex] = [];
    }
    return storedIfcItem[matIndex];
  }

}

class SubsetUtils {

  static getAllIndicesOfGroup(modelID, ids, materialIndex, items, flatten = true) {
    const indicesByGroup = [];
    for (const expressID of ids) {
      const entry = items.map.get(expressID);
      if (!entry)
        continue;
      const value = entry[materialIndex];
      if (!value)
        continue;
      SubsetUtils.getIndexChunk(value, indicesByGroup, materialIndex, items, flatten);
    }
    return indicesByGroup;
  }

  static getIndexChunk(value, indicesByGroup, materialIndex, items, flatten) {
    const pairs = value.length / 2;
    for (let pair = 0; pair < pairs; pair++) {
      const pairIndex = pair * 2;
      const start = value[pairIndex];
      const end = value[pairIndex + 1];
      for (let j = start; j <= end; j++) {
        if (flatten)
          indicesByGroup.push(items.indexCache[j]);
        else {
          if (!indicesByGroup[materialIndex])
            indicesByGroup[materialIndex] = [];
          indicesByGroup[materialIndex].push(items.indexCache[j]);
        }
      }
    }
  }

}

class SubsetCreator {

  constructor(state, items, subsets, BVH) {
    this.state = state;
    this.items = items;
    this.subsets = subsets;
    this.BVH = BVH;
    this.tempIndex = [];
  }

  createSubset(config, subsetID) {
    if (!this.items.map[config.modelID])
      this.items.generateGeometryIndexMap(config.modelID);
    if (!this.subsets[subsetID])
      this.initializeSubset(config, subsetID);
    this.filterIndices(config, subsetID);
    this.constructSubsetByMaterial(config, subsetID);
    config.ids.forEach(id => this.subsets[subsetID].ids.add(id));
    this.subsets[subsetID].mesh.geometry.setIndex(this.tempIndex);
    this.tempIndex.length = 0;
    const subset = this.subsets[subsetID].mesh;
    if (config.applyBVH)
      this.BVH.applyThreeMeshBVH(subset.geometry);
    if (config.scene)
      config.scene.add(subset);
    return this.subsets[subsetID].mesh;
  }

  dispose() {
    this.tempIndex = [];
  }

  initializeSubset(config, subsetID) {
    const model = this.state.models[config.modelID].mesh;
    const subsetGeom = new BufferGeometry();
    this.initializeSubsetAttributes(subsetGeom, model);
    if (!config.material)
      this.initializeSubsetGroups(subsetGeom, model);
    const mesh = new Mesh(subsetGeom, config.material || model.material);
    mesh.modelID = config.modelID;
    const bvh = Boolean(config.applyBVH);
    this.subsets[subsetID] = {
      ids: new Set(),
      mesh,
      bvh
    };
    model.add(mesh);
  }

  initializeSubsetAttributes(subsetGeom, model) {
    subsetGeom.setAttribute('position', model.geometry.attributes.position);
    subsetGeom.setAttribute('normal', model.geometry.attributes.normal);
    subsetGeom.setAttribute('expressID', model.geometry.attributes.expressID);
    subsetGeom.setIndex([]);
  }

  initializeSubsetGroups(subsetGeom, model) {
    subsetGeom.groups = JSON.parse(JSON.stringify(model.geometry.groups));
    this.resetGroups(subsetGeom);
  }

  filterIndices(config, subsetID) {
    const geometry = this.subsets[subsetID].mesh.geometry;
    if (config.removePrevious) {
      geometry.setIndex([]);
      this.resetGroups(geometry);
      return;
    }
    const previousIndices = geometry.index.array;
    const previousIDs = this.subsets[subsetID].ids;
    config.ids = config.ids.filter(id => !previousIDs.has(id));
    this.tempIndex = Array.from(previousIndices);
  }

  constructSubsetByMaterial(config, subsetID) {
    const model = this.state.models[config.modelID].mesh;
    const newIndices = {
      count: 0
    };
    for (let i = 0; i < model.geometry.groups.length; i++) {
      this.insertNewIndices(config, subsetID, i, newIndices);
    }
  }

  insertNewIndices(config, subsetID, materialIndex, newIndices) {
    const items = this.items.map[config.modelID];
    const indicesOfOneMaterial = SubsetUtils.getAllIndicesOfGroup(config.modelID, config.ids, materialIndex, items);
    if (!config.material) {
      this.insertIndicesAtGroup(subsetID, indicesOfOneMaterial, materialIndex, newIndices);
    } else {
      indicesOfOneMaterial.forEach(index => this.tempIndex.push(index));
    }
  }

  insertIndicesAtGroup(subsetID, indicesByGroup, index, newIndices) {
    const currentGroup = this.getCurrentGroup(subsetID, index);
    currentGroup.start += newIndices.count;
    let newIndicesPosition = currentGroup.start + currentGroup.count;
    newIndices.count += indicesByGroup.length;
    if (indicesByGroup.length > 0) {
      let position = newIndicesPosition;
      const start = this.tempIndex.slice(0, position);
      const end = this.tempIndex.slice(position);
      this.tempIndex = Array.prototype.concat.apply([], [start, indicesByGroup, end]);
      currentGroup.count += indicesByGroup.length;
    }
  }

  getCurrentGroup(subsetID, groupIndex) {
    const geometry = this.subsets[subsetID].mesh.geometry;
    return geometry.groups[groupIndex];
  }

  resetGroups(geometry) {
    geometry.groups.forEach((group) => {
      group.start = 0;
      group.count = 0;
    });
  }

}

class SubsetManager {

  constructor(state, BVH) {
    this.subsets = {};
    this.state = state;
    this.items = new ItemsMap(state);
    this.BVH = BVH;
    this.subsetCreator = new SubsetCreator(state, this.items, this.subsets, this.BVH);
  }

  getAllSubsets() {
    return this.subsets;
  }

  getSubset(modelID, material, customId) {
    const subsetID = this.getSubsetID(modelID, material, customId);
    return this.subsets[subsetID].mesh;
  }

  removeSubset(modelID, material, customID) {
    const subsetID = this.getSubsetID(modelID, material, customID);
    const subset = this.subsets[subsetID];
    if (!subset)
      return;
    if (subset.mesh.parent)
      subset.mesh.removeFromParent();
    subset.mesh.geometry.attributes = {};
    subset.mesh.geometry.index = null;
    subset.mesh.geometry.dispose();
    subset.mesh.geometry = null;
    delete this.subsets[subsetID];
  }

  createSubset(config) {
    const subsetID = this.getSubsetID(config.modelID, config.material, config.customID);
    return this.subsetCreator.createSubset(config, subsetID);
  }

  removeFromSubset(modelID, ids, customID, material) {
    const subsetID = this.getSubsetID(modelID, material, customID);
    if (!this.subsets[subsetID])
      return;
    const previousIDs = this.subsets[subsetID].ids;
    ids.forEach((id) => {
      if (previousIDs.has(id))
        previousIDs.delete(id);
    });
    return this.createSubset({
      modelID,
      removePrevious: true,
      material,
      customID,
      applyBVH: this.subsets[subsetID].bvh,
      ids: Array.from(previousIDs),
      scene: this.subsets[subsetID].mesh.parent
    });
  }

  clearSubset(modelID, customID, material) {
    const subsetID = this.getSubsetID(modelID, material, customID);
    if (!this.subsets[subsetID])
      return;
    this.subsets[subsetID].ids.clear();
    const subset = this.getSubset(modelID, material, customID);
    subset.geometry.setIndex([]);
  }

  dispose() {
    this.items.dispose();
    this.subsetCreator.dispose();
    Object.values(this.subsets).forEach(subset => {
      subset.ids = null;
      subset.mesh.removeFromParent();
      const mats = subset.mesh.material;
      if (Array.isArray(mats))
        mats.forEach(mat => mat.dispose());
      else
        mats.dispose();
      subset.mesh.geometry.index = null;
      subset.mesh.geometry.dispose();
      const geom = subset.mesh.geometry;
      if (geom.disposeBoundsTree)
        geom.disposeBoundsTree();
      subset.mesh = null;
    });
    this.subsets = null;
  }

  getSubsetID(modelID, material, customID = 'DEFAULT') {
    const baseID = modelID;
    const materialID = material ? material.uuid : 'DEFAULT';
    return `${baseID} - ${materialID} - ${customID}`;
  }

}

const IdAttrName = 'expressID';
const PropsNames = {
  aggregates: {
    name: IFCRELAGGREGATES,
    relating: 'RelatingObject',
    related: 'RelatedObjects',
    key: 'children'
  },
  spatial: {
    name: IFCRELCONTAINEDINSPATIALSTRUCTURE,
    relating: 'RelatingStructure',
    related: 'RelatedElements',
    key: 'children'
  },
  psets: {
    name: IFCRELDEFINESBYPROPERTIES,
    relating: 'RelatingPropertyDefinition',
    related: 'RelatedObjects',
    key: 'hasPsets'
  },
  materials: {
    name: IFCRELASSOCIATESMATERIAL,
    relating: 'RelatingMaterial',
    related: 'RelatedObjects',
    key: 'hasMaterial'
  },
  type: {
    name: IFCRELDEFINESBYTYPE,
    relating: 'RelatingType',
    related: 'RelatedObjects',
    key: 'hasType'
  }
};

class BasePropertyManager {

  constructor(state) {
    this.state = state;
  }

  async getPropertySets(modelID, elementID, recursive = false) {
    return await this.getProperty(modelID, elementID, recursive, PropsNames.psets);
  }

  async getTypeProperties(modelID, elementID, recursive = false) {
    return await this.getProperty(modelID, elementID, recursive, PropsNames.type);
  }

  async getMaterialsProperties(modelID, elementID, recursive = false) {
    return await this.getProperty(modelID, elementID, recursive, PropsNames.materials);
  }

  async getSpatialNode(modelID, node, treeChunks, includeProperties) {
    await this.getChildren(modelID, node, treeChunks, PropsNames.aggregates, includeProperties);
    await this.getChildren(modelID, node, treeChunks, PropsNames.spatial, includeProperties);
  }

  async getChildren(modelID, node, treeChunks, propNames, includeProperties) {
    const children = treeChunks[node.expressID];
    if (children == undefined)
      return;
    const prop = propNames.key;
    const nodes = [];
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      let node = this.newNode(modelID, child);
      if (includeProperties) {
        const properties = await this.getItemProperties(modelID, node.expressID);
        node = {
          ...properties, ...node
        };
      }
      await this.getSpatialNode(modelID, node, treeChunks, includeProperties);
      nodes.push(node);
    }
    node[prop] = nodes;
  }

  newNode(modelID, id) {
    const typeName = this.getNodeType(modelID, id);
    return {
      expressID: id,
      type: typeName,
      children: []
    };
  }

  async getSpatialTreeChunks(modelID) {
    const treeChunks = {};
    await this.getChunks(modelID, treeChunks, PropsNames.aggregates);
    await this.getChunks(modelID, treeChunks, PropsNames.spatial);
    return treeChunks;
  }

  saveChunk(chunks, propNames, rel) {
    const relating = rel[propNames.relating].value;
    const related = rel[propNames.related].map((r) => r.value);
    if (chunks[relating] == undefined) {
      chunks[relating] = related;
    } else {
      chunks[relating] = chunks[relating].concat(related);
    }
  }

  getRelated(rel, propNames, IDs) {
    const element = rel[propNames.relating];
    if (!element) {
      return console.warn(`The object with ID ${rel.expressID} has a broken reference.`);
    }
    if (!Array.isArray(element))
      IDs.push(element.value);
    else
      element.forEach((ele) => IDs.push(ele.value));
  }

  static isRelated(id, rel, propNames) {
    const relatedItems = rel[propNames.related];
    if (Array.isArray(relatedItems)) {
      const values = relatedItems.map((item) => item.value);
      return values.includes(id);
    }
    return relatedItems.value === id;
  }

  static newIfcProject(id) {
    return {
      expressID: id,
      type: 'IFCPROJECT',
      children: []
    };
  }

  async getProperty(modelID, elementID, recursive = false, propName) {}

  async getChunks(modelID, chunks, propNames) {}

  async getItemProperties(modelID, expressID, recursive = false) {}

  getNodeType(modelID, id) {}

}

let IfcElements = {
  103090709: 'IFCPROJECT',
  4097777520: 'IFCSITE',
  4031249490: 'IFCBUILDING',
  3124254112: 'IFCBUILDINGSTOREY',
  3856911033: 'IFCSPACE',
  1674181508: 'IFCANNOTATION',
  25142252: 'IFCCONTROLLER',
  32344328: 'IFCBOILER',
  76236018: 'IFCLAMP',
  90941305: 'IFCPUMP',
  177149247: 'IFCAIRTERMINALBOX',
  182646315: 'IFCFLOWINSTRUMENT',
  263784265: 'IFCFURNISHINGELEMENT',
  264262732: 'IFCELECTRICGENERATOR',
  277319702: 'IFCAUDIOVISUALAPPLIANCE',
  310824031: 'IFCPIPEFITTING',
  331165859: 'IFCSTAIR',
  342316401: 'IFCDUCTFITTING',
  377706215: 'IFCMECHANICALFASTENER',
  395920057: 'IFCDOOR',
  402227799: 'IFCELECTRICMOTOR',
  413509423: 'IFCSYSTEMFURNITUREELEMENT',
  484807127: 'IFCEVAPORATOR',
  486154966: 'IFCWINDOWSTANDARDCASE',
  629592764: 'IFCLIGHTFIXTURE',
  630975310: 'IFCUNITARYCONTROLELEMENT',
  635142910: 'IFCCABLECARRIERFITTING',
  639361253: 'IFCCOIL',
  647756555: 'IFCFASTENER',
  707683696: 'IFCFLOWSTORAGEDEVICE',
  738039164: 'IFCPROTECTIVEDEVICE',
  753842376: 'IFCBEAM',
  812556717: 'IFCTANK',
  819412036: 'IFCFILTER',
  843113511: 'IFCCOLUMN',
  862014818: 'IFCELECTRICDISTRIBUTIONBOARD',
  900683007: 'IFCFOOTING',
  905975707: 'IFCCOLUMNSTANDARDCASE',
  926996030: 'IFCVOIDINGFEATURE',
  979691226: 'IFCREINFORCINGBAR',
  987401354: 'IFCFLOWSEGMENT',
  1003880860: 'IFCELECTRICTIMECONTROL',
  1051757585: 'IFCCABLEFITTING',
  1052013943: 'IFCDISTRIBUTIONCHAMBERELEMENT',
  1062813311: 'IFCDISTRIBUTIONCONTROLELEMENT',
  1073191201: 'IFCMEMBER',
  1095909175: 'IFCBUILDINGELEMENTPROXY',
  1156407060: 'IFCPLATESTANDARDCASE',
  1162798199: 'IFCSWITCHINGDEVICE',
  1329646415: 'IFCSHADINGDEVICE',
  1335981549: 'IFCDISCRETEACCESSORY',
  1360408905: 'IFCDUCTSILENCER',
  1404847402: 'IFCSTACKTERMINAL',
  1426591983: 'IFCFIRESUPPRESSIONTERMINAL',
  1437502449: 'IFCMEDICALDEVICE',
  1509553395: 'IFCFURNITURE',
  1529196076: 'IFCSLAB',
  1620046519: 'IFCTRANSPORTELEMENT',
  1634111441: 'IFCAIRTERMINAL',
  1658829314: 'IFCENERGYCONVERSIONDEVICE',
  1677625105: 'IFCCIVILELEMENT',
  1687234759: 'IFCPILE',
  1904799276: 'IFCELECTRICAPPLIANCE',
  1911478936: 'IFCMEMBERSTANDARDCASE',
  1945004755: 'IFCDISTRIBUTIONELEMENT',
  1973544240: 'IFCCOVERING',
  1999602285: 'IFCSPACEHEATER',
  2016517767: 'IFCROOF',
  2056796094: 'IFCAIRTOAIRHEATRECOVERY',
  2058353004: 'IFCFLOWCONTROLLER',
  2068733104: 'IFCHUMIDIFIER',
  2176052936: 'IFCJUNCTIONBOX',
  2188021234: 'IFCFLOWMETER',
  2223149337: 'IFCFLOWTERMINAL',
  2262370178: 'IFCRAILING',
  2272882330: 'IFCCONDENSER',
  2295281155: 'IFCPROTECTIVEDEVICETRIPPINGUNIT',
  2320036040: 'IFCREINFORCINGMESH',
  2347447852: 'IFCTENDONANCHOR',
  2391383451: 'IFCVIBRATIONISOLATOR',
  2391406946: 'IFCWALL',
  2474470126: 'IFCMOTORCONNECTION',
  2769231204: 'IFCVIRTUALELEMENT',
  2814081492: 'IFCENGINE',
  2906023776: 'IFCBEAMSTANDARDCASE',
  2938176219: 'IFCBURNER',
  2979338954: 'IFCBUILDINGELEMENTPART',
  3024970846: 'IFCRAMP',
  3026737570: 'IFCTUBEBUNDLE',
  3027962421: 'IFCSLABSTANDARDCASE',
  3040386961: 'IFCDISTRIBUTIONFLOWELEMENT',
  3053780830: 'IFCSANITARYTERMINAL',
  3079942009: 'IFCOPENINGSTANDARDCASE',
  3087945054: 'IFCALARM',
  3101698114: 'IFCSURFACEFEATURE',
  3127900445: 'IFCSLABELEMENTEDCASE',
  3132237377: 'IFCFLOWMOVINGDEVICE',
  3171933400: 'IFCPLATE',
  3221913625: 'IFCCOMMUNICATIONSAPPLIANCE',
  3242481149: 'IFCDOORSTANDARDCASE',
  3283111854: 'IFCRAMPFLIGHT',
  3296154744: 'IFCCHIMNEY',
  3304561284: 'IFCWINDOW',
  3310460725: 'IFCELECTRICFLOWSTORAGEDEVICE',
  3319311131: 'IFCHEATEXCHANGER',
  3415622556: 'IFCFAN',
  3420628829: 'IFCSOLARDEVICE',
  3493046030: 'IFCGEOGRAPHICELEMENT',
  3495092785: 'IFCCURTAINWALL',
  3508470533: 'IFCFLOWTREATMENTDEVICE',
  3512223829: 'IFCWALLSTANDARDCASE',
  3518393246: 'IFCDUCTSEGMENT',
  3571504051: 'IFCCOMPRESSOR',
  3588315303: 'IFCOPENINGELEMENT',
  3612865200: 'IFCPIPESEGMENT',
  3640358203: 'IFCCOOLINGTOWER',
  3651124850: 'IFCPROJECTIONELEMENT',
  3694346114: 'IFCOUTLET',
  3747195512: 'IFCEVAPORATIVECOOLER',
  3758799889: 'IFCCABLECARRIERSEGMENT',
  3824725483: 'IFCTENDON',
  3825984169: 'IFCTRANSFORMER',
  3902619387: 'IFCCHILLER',
  4074379575: 'IFCDAMPER',
  4086658281: 'IFCSENSOR',
  4123344466: 'IFCELEMENTASSEMBLY',
  4136498852: 'IFCCOOLEDBEAM',
  4156078855: 'IFCWALLELEMENTEDCASE',
  4175244083: 'IFCINTERCEPTOR',
  4207607924: 'IFCVALVE',
  4217484030: 'IFCCABLESEGMENT',
  4237592921: 'IFCWASTETERMINAL',
  4252922144: 'IFCSTAIRFLIGHT',
  4278956645: 'IFCFLOWFITTING',
  4288193352: 'IFCACTUATOR',
  4292641817: 'IFCUNITARYEQUIPMENT',
  3009204131: 'IFCGRID'
};

class WebIfcPropertyManager extends BasePropertyManager {

  async getItemProperties(modelID, id, recursive = false) {
    return this.state.api.GetLine(modelID, id, recursive);
  }

  async getSpatialStructure(modelID, includeProperties) {
    const chunks = await this.getSpatialTreeChunks(modelID);
    const allLines = await this.state.api.GetLineIDsWithType(modelID, IFCPROJECT);
    const projectID = allLines.get(0);
    const project = WebIfcPropertyManager.newIfcProject(projectID);
    await this.getSpatialNode(modelID, project, chunks, includeProperties);
    return project;
  }

  async getAllItemsOfType(modelID, type, verbose) {
    let items = [];
    const lines = await this.state.api.GetLineIDsWithType(modelID, type);
    for (let i = 0; i < lines.size(); i++)
      items.push(lines.get(i));
    if (!verbose)
      return items;
    const result = [];
    for (let i = 0; i < items.length; i++) {
      result.push(await this.state.api.GetLine(modelID, items[i]));
    }
    return result;
  }

  async getProperty(modelID, elementID, recursive = false, propName) {
    const propSetIds = await this.getAllRelatedItemsOfType(modelID, elementID, propName);
    const result = [];
    for (let i = 0; i < propSetIds.length; i++) {
      result.push(await this.state.api.GetLine(modelID, propSetIds[i], recursive));
    }
    return result;
  }

  getNodeType(modelID, id) {
    const typeID = this.state.models[modelID].types[id];
    return IfcElements[typeID];
  }

  async getChunks(modelID, chunks, propNames) {
    const relation = await this.state.api.GetLineIDsWithType(modelID, propNames.name);
    for (let i = 0; i < relation.size(); i++) {
      const rel = await this.state.api.GetLine(modelID, relation.get(i), false);
      this.saveChunk(chunks, propNames, rel);
    }
  }

  async getAllRelatedItemsOfType(modelID, id, propNames) {
    const lines = await this.state.api.GetLineIDsWithType(modelID, propNames.name);
    const IDs = [];
    for (let i = 0; i < lines.size(); i++) {
      const rel = await this.state.api.GetLine(modelID, lines.get(i));
      const isRelated = BasePropertyManager.isRelated(id, rel, propNames);
      if (isRelated)
        this.getRelated(rel, propNames, IDs);
    }
    return IDs;
  }

}

let IfcTypesMap = {
  3821786052: "IFCACTIONREQUEST",
  2296667514: "IFCACTOR",
  3630933823: "IFCACTORROLE",
  4288193352: "IFCACTUATOR",
  2874132201: "IFCACTUATORTYPE",
  618182010: "IFCADDRESS",
  1635779807: "IFCADVANCEDBREP",
  2603310189: "IFCADVANCEDBREPWITHVOIDS",
  3406155212: "IFCADVANCEDFACE",
  1634111441: "IFCAIRTERMINAL",
  177149247: "IFCAIRTERMINALBOX",
  1411407467: "IFCAIRTERMINALBOXTYPE",
  3352864051: "IFCAIRTERMINALTYPE",
  2056796094: "IFCAIRTOAIRHEATRECOVERY",
  1871374353: "IFCAIRTOAIRHEATRECOVERYTYPE",
  3087945054: "IFCALARM",
  3001207471: "IFCALARMTYPE",
  325726236: "IFCALIGNMENT",
  749761778: "IFCALIGNMENT2DHORIZONTAL",
  3199563722: "IFCALIGNMENT2DHORIZONTALSEGMENT",
  2483840362: "IFCALIGNMENT2DSEGMENT",
  3379348081: "IFCALIGNMENT2DVERSEGCIRCULARARC",
  3239324667: "IFCALIGNMENT2DVERSEGLINE",
  4263986512: "IFCALIGNMENT2DVERSEGPARABOLICARC",
  53199957: "IFCALIGNMENT2DVERTICAL",
  2029264950: "IFCALIGNMENT2DVERTICALSEGMENT",
  3512275521: "IFCALIGNMENTCURVE",
  1674181508: "IFCANNOTATION",
  669184980: "IFCANNOTATIONFILLAREA",
  639542469: "IFCAPPLICATION",
  411424972: "IFCAPPLIEDVALUE",
  130549933: "IFCAPPROVAL",
  3869604511: "IFCAPPROVALRELATIONSHIP",
  3798115385: "IFCARBITRARYCLOSEDPROFILEDEF",
  1310608509: "IFCARBITRARYOPENPROFILEDEF",
  2705031697: "IFCARBITRARYPROFILEDEFWITHVOIDS",
  3460190687: "IFCASSET",
  3207858831: "IFCASYMMETRICISHAPEPROFILEDEF",
  277319702: "IFCAUDIOVISUALAPPLIANCE",
  1532957894: "IFCAUDIOVISUALAPPLIANCETYPE",
  4261334040: "IFCAXIS1PLACEMENT",
  3125803723: "IFCAXIS2PLACEMENT2D",
  2740243338: "IFCAXIS2PLACEMENT3D",
  1967976161: "IFCBSPLINECURVE",
  2461110595: "IFCBSPLINECURVEWITHKNOTS",
  2887950389: "IFCBSPLINESURFACE",
  167062518: "IFCBSPLINESURFACEWITHKNOTS",
  753842376: "IFCBEAM",
  2906023776: "IFCBEAMSTANDARDCASE",
  819618141: "IFCBEAMTYPE",
  4196446775: "IFCBEARING",
  3649138523: "IFCBEARINGTYPE",
  616511568: "IFCBLOBTEXTURE",
  1334484129: "IFCBLOCK",
  32344328: "IFCBOILER",
  231477066: "IFCBOILERTYPE",
  3649129432: "IFCBOOLEANCLIPPINGRESULT",
  2736907675: "IFCBOOLEANRESULT",
  4037036970: "IFCBOUNDARYCONDITION",
  1136057603: "IFCBOUNDARYCURVE",
  1560379544: "IFCBOUNDARYEDGECONDITION",
  3367102660: "IFCBOUNDARYFACECONDITION",
  1387855156: "IFCBOUNDARYNODECONDITION",
  2069777674: "IFCBOUNDARYNODECONDITIONWARPING",
  1260505505: "IFCBOUNDEDCURVE",
  4182860854: "IFCBOUNDEDSURFACE",
  2581212453: "IFCBOUNDINGBOX",
  2713105998: "IFCBOXEDHALFSPACE",
  644574406: "IFCBRIDGE",
  963979645: "IFCBRIDGEPART",
  4031249490: "IFCBUILDING",
  3299480353: "IFCBUILDINGELEMENT",
  2979338954: "IFCBUILDINGELEMENTPART",
  39481116: "IFCBUILDINGELEMENTPARTTYPE",
  1095909175: "IFCBUILDINGELEMENTPROXY",
  1909888760: "IFCBUILDINGELEMENTPROXYTYPE",
  1950629157: "IFCBUILDINGELEMENTTYPE",
  3124254112: "IFCBUILDINGSTOREY",
  1177604601: "IFCBUILDINGSYSTEM",
  2938176219: "IFCBURNER",
  2188180465: "IFCBURNERTYPE",
  2898889636: "IFCCSHAPEPROFILEDEF",
  635142910: "IFCCABLECARRIERFITTING",
  395041908: "IFCCABLECARRIERFITTINGTYPE",
  3758799889: "IFCCABLECARRIERSEGMENT",
  3293546465: "IFCCABLECARRIERSEGMENTTYPE",
  1051757585: "IFCCABLEFITTING",
  2674252688: "IFCCABLEFITTINGTYPE",
  4217484030: "IFCCABLESEGMENT",
  1285652485: "IFCCABLESEGMENTTYPE",
  3999819293: "IFCCAISSONFOUNDATION",
  3203706013: "IFCCAISSONFOUNDATIONTYPE",
  1123145078: "IFCCARTESIANPOINT",
  574549367: "IFCCARTESIANPOINTLIST",
  1675464909: "IFCCARTESIANPOINTLIST2D",
  2059837836: "IFCCARTESIANPOINTLIST3D",
  59481748: "IFCCARTESIANTRANSFORMATIONOPERATOR",
  3749851601: "IFCCARTESIANTRANSFORMATIONOPERATOR2D",
  3486308946: "IFCCARTESIANTRANSFORMATIONOPERATOR2DNONUNIFORM",
  3331915920: "IFCCARTESIANTRANSFORMATIONOPERATOR3D",
  1416205885: "IFCCARTESIANTRANSFORMATIONOPERATOR3DNONUNIFORM",
  3150382593: "IFCCENTERLINEPROFILEDEF",
  3902619387: "IFCCHILLER",
  2951183804: "IFCCHILLERTYPE",
  3296154744: "IFCCHIMNEY",
  2197970202: "IFCCHIMNEYTYPE",
  2611217952: "IFCCIRCLE",
  2937912522: "IFCCIRCLEHOLLOWPROFILEDEF",
  1383045692: "IFCCIRCLEPROFILEDEF",
  1062206242: "IFCCIRCULARARCSEGMENT2D",
  1677625105: "IFCCIVILELEMENT",
  3893394355: "IFCCIVILELEMENTTYPE",
  747523909: "IFCCLASSIFICATION",
  647927063: "IFCCLASSIFICATIONREFERENCE",
  2205249479: "IFCCLOSEDSHELL",
  639361253: "IFCCOIL",
  2301859152: "IFCCOILTYPE",
  776857604: "IFCCOLOURRGB",
  3285139300: "IFCCOLOURRGBLIST",
  3264961684: "IFCCOLOURSPECIFICATION",
  843113511: "IFCCOLUMN",
  905975707: "IFCCOLUMNSTANDARDCASE",
  300633059: "IFCCOLUMNTYPE",
  3221913625: "IFCCOMMUNICATIONSAPPLIANCE",
  400855858: "IFCCOMMUNICATIONSAPPLIANCETYPE",
  2542286263: "IFCCOMPLEXPROPERTY",
  3875453745: "IFCCOMPLEXPROPERTYTEMPLATE",
  3732776249: "IFCCOMPOSITECURVE",
  15328376: "IFCCOMPOSITECURVEONSURFACE",
  2485617015: "IFCCOMPOSITECURVESEGMENT",
  1485152156: "IFCCOMPOSITEPROFILEDEF",
  3571504051: "IFCCOMPRESSOR",
  3850581409: "IFCCOMPRESSORTYPE",
  2272882330: "IFCCONDENSER",
  2816379211: "IFCCONDENSERTYPE",
  2510884976: "IFCCONIC",
  370225590: "IFCCONNECTEDFACESET",
  1981873012: "IFCCONNECTIONCURVEGEOMETRY",
  2859738748: "IFCCONNECTIONGEOMETRY",
  45288368: "IFCCONNECTIONPOINTECCENTRICITY",
  2614616156: "IFCCONNECTIONPOINTGEOMETRY",
  2732653382: "IFCCONNECTIONSURFACEGEOMETRY",
  775493141: "IFCCONNECTIONVOLUMEGEOMETRY",
  1959218052: "IFCCONSTRAINT",
  3898045240: "IFCCONSTRUCTIONEQUIPMENTRESOURCE",
  2185764099: "IFCCONSTRUCTIONEQUIPMENTRESOURCETYPE",
  1060000209: "IFCCONSTRUCTIONMATERIALRESOURCE",
  4105962743: "IFCCONSTRUCTIONMATERIALRESOURCETYPE",
  488727124: "IFCCONSTRUCTIONPRODUCTRESOURCE",
  1525564444: "IFCCONSTRUCTIONPRODUCTRESOURCETYPE",
  2559216714: "IFCCONSTRUCTIONRESOURCE",
  2574617495: "IFCCONSTRUCTIONRESOURCETYPE",
  3419103109: "IFCCONTEXT",
  3050246964: "IFCCONTEXTDEPENDENTUNIT",
  3293443760: "IFCCONTROL",
  25142252: "IFCCONTROLLER",
  578613899: "IFCCONTROLLERTYPE",
  2889183280: "IFCCONVERSIONBASEDUNIT",
  2713554722: "IFCCONVERSIONBASEDUNITWITHOFFSET",
  4136498852: "IFCCOOLEDBEAM",
  335055490: "IFCCOOLEDBEAMTYPE",
  3640358203: "IFCCOOLINGTOWER",
  2954562838: "IFCCOOLINGTOWERTYPE",
  1785450214: "IFCCOORDINATEOPERATION",
  1466758467: "IFCCOORDINATEREFERENCESYSTEM",
  3895139033: "IFCCOSTITEM",
  1419761937: "IFCCOSTSCHEDULE",
  602808272: "IFCCOSTVALUE",
  1973544240: "IFCCOVERING",
  1916426348: "IFCCOVERINGTYPE",
  3295246426: "IFCCREWRESOURCE",
  1815067380: "IFCCREWRESOURCETYPE",
  2506170314: "IFCCSGPRIMITIVE3D",
  2147822146: "IFCCSGSOLID",
  539742890: "IFCCURRENCYRELATIONSHIP",
  3495092785: "IFCCURTAINWALL",
  1457835157: "IFCCURTAINWALLTYPE",
  2601014836: "IFCCURVE",
  2827736869: "IFCCURVEBOUNDEDPLANE",
  2629017746: "IFCCURVEBOUNDEDSURFACE",
  1186437898: "IFCCURVESEGMENT2D",
  3800577675: "IFCCURVESTYLE",
  1105321065: "IFCCURVESTYLEFONT",
  2367409068: "IFCCURVESTYLEFONTANDSCALING",
  3510044353: "IFCCURVESTYLEFONTPATTERN",
  1213902940: "IFCCYLINDRICALSURFACE",
  4074379575: "IFCDAMPER",
  3961806047: "IFCDAMPERTYPE",
  3426335179: "IFCDEEPFOUNDATION",
  1306400036: "IFCDEEPFOUNDATIONTYPE",
  3632507154: "IFCDERIVEDPROFILEDEF",
  1765591967: "IFCDERIVEDUNIT",
  1045800335: "IFCDERIVEDUNITELEMENT",
  2949456006: "IFCDIMENSIONALEXPONENTS",
  32440307: "IFCDIRECTION",
  1335981549: "IFCDISCRETEACCESSORY",
  2635815018: "IFCDISCRETEACCESSORYTYPE",
  1945343521: "IFCDISTANCEEXPRESSION",
  1052013943: "IFCDISTRIBUTIONCHAMBERELEMENT",
  1599208980: "IFCDISTRIBUTIONCHAMBERELEMENTTYPE",
  562808652: "IFCDISTRIBUTIONCIRCUIT",
  1062813311: "IFCDISTRIBUTIONCONTROLELEMENT",
  2063403501: "IFCDISTRIBUTIONCONTROLELEMENTTYPE",
  1945004755: "IFCDISTRIBUTIONELEMENT",
  3256556792: "IFCDISTRIBUTIONELEMENTTYPE",
  3040386961: "IFCDISTRIBUTIONFLOWELEMENT",
  3849074793: "IFCDISTRIBUTIONFLOWELEMENTTYPE",
  3041715199: "IFCDISTRIBUTIONPORT",
  3205830791: "IFCDISTRIBUTIONSYSTEM",
  1154170062: "IFCDOCUMENTINFORMATION",
  770865208: "IFCDOCUMENTINFORMATIONRELATIONSHIP",
  3732053477: "IFCDOCUMENTREFERENCE",
  395920057: "IFCDOOR",
  2963535650: "IFCDOORLININGPROPERTIES",
  1714330368: "IFCDOORPANELPROPERTIES",
  3242481149: "IFCDOORSTANDARDCASE",
  526551008: "IFCDOORSTYLE",
  2323601079: "IFCDOORTYPE",
  445594917: "IFCDRAUGHTINGPREDEFINEDCOLOUR",
  4006246654: "IFCDRAUGHTINGPREDEFINEDCURVEFONT",
  342316401: "IFCDUCTFITTING",
  869906466: "IFCDUCTFITTINGTYPE",
  3518393246: "IFCDUCTSEGMENT",
  3760055223: "IFCDUCTSEGMENTTYPE",
  1360408905: "IFCDUCTSILENCER",
  2030761528: "IFCDUCTSILENCERTYPE",
  3900360178: "IFCEDGE",
  476780140: "IFCEDGECURVE",
  1472233963: "IFCEDGELOOP",
  1904799276: "IFCELECTRICAPPLIANCE",
  663422040: "IFCELECTRICAPPLIANCETYPE",
  862014818: "IFCELECTRICDISTRIBUTIONBOARD",
  2417008758: "IFCELECTRICDISTRIBUTIONBOARDTYPE",
  3310460725: "IFCELECTRICFLOWSTORAGEDEVICE",
  3277789161: "IFCELECTRICFLOWSTORAGEDEVICETYPE",
  264262732: "IFCELECTRICGENERATOR",
  1534661035: "IFCELECTRICGENERATORTYPE",
  402227799: "IFCELECTRICMOTOR",
  1217240411: "IFCELECTRICMOTORTYPE",
  1003880860: "IFCELECTRICTIMECONTROL",
  712377611: "IFCELECTRICTIMECONTROLTYPE",
  1758889154: "IFCELEMENT",
  4123344466: "IFCELEMENTASSEMBLY",
  2397081782: "IFCELEMENTASSEMBLYTYPE",
  1623761950: "IFCELEMENTCOMPONENT",
  2590856083: "IFCELEMENTCOMPONENTTYPE",
  1883228015: "IFCELEMENTQUANTITY",
  339256511: "IFCELEMENTTYPE",
  2777663545: "IFCELEMENTARYSURFACE",
  1704287377: "IFCELLIPSE",
  2835456948: "IFCELLIPSEPROFILEDEF",
  1658829314: "IFCENERGYCONVERSIONDEVICE",
  2107101300: "IFCENERGYCONVERSIONDEVICETYPE",
  2814081492: "IFCENGINE",
  132023988: "IFCENGINETYPE",
  3747195512: "IFCEVAPORATIVECOOLER",
  3174744832: "IFCEVAPORATIVECOOLERTYPE",
  484807127: "IFCEVAPORATOR",
  3390157468: "IFCEVAPORATORTYPE",
  4148101412: "IFCEVENT",
  211053100: "IFCEVENTTIME",
  4024345920: "IFCEVENTTYPE",
  297599258: "IFCEXTENDEDPROPERTIES",
  4294318154: "IFCEXTERNALINFORMATION",
  3200245327: "IFCEXTERNALREFERENCE",
  1437805879: "IFCEXTERNALREFERENCERELATIONSHIP",
  1209101575: "IFCEXTERNALSPATIALELEMENT",
  2853485674: "IFCEXTERNALSPATIALSTRUCTUREELEMENT",
  2242383968: "IFCEXTERNALLYDEFINEDHATCHSTYLE",
  1040185647: "IFCEXTERNALLYDEFINEDSURFACESTYLE",
  3548104201: "IFCEXTERNALLYDEFINEDTEXTFONT",
  477187591: "IFCEXTRUDEDAREASOLID",
  2804161546: "IFCEXTRUDEDAREASOLIDTAPERED",
  2556980723: "IFCFACE",
  2047409740: "IFCFACEBASEDSURFACEMODEL",
  1809719519: "IFCFACEBOUND",
  803316827: "IFCFACEOUTERBOUND",
  3008276851: "IFCFACESURFACE",
  807026263: "IFCFACETEDBREP",
  3737207727: "IFCFACETEDBREPWITHVOIDS",
  24185140: "IFCFACILITY",
  1310830890: "IFCFACILITYPART",
  4219587988: "IFCFAILURECONNECTIONCONDITION",
  3415622556: "IFCFAN",
  346874300: "IFCFANTYPE",
  647756555: "IFCFASTENER",
  2489546625: "IFCFASTENERTYPE",
  2827207264: "IFCFEATUREELEMENT",
  2143335405: "IFCFEATUREELEMENTADDITION",
  1287392070: "IFCFEATUREELEMENTSUBTRACTION",
  738692330: "IFCFILLAREASTYLE",
  374418227: "IFCFILLAREASTYLEHATCHING",
  315944413: "IFCFILLAREASTYLETILES",
  819412036: "IFCFILTER",
  1810631287: "IFCFILTERTYPE",
  1426591983: "IFCFIRESUPPRESSIONTERMINAL",
  4222183408: "IFCFIRESUPPRESSIONTERMINALTYPE",
  2652556860: "IFCFIXEDREFERENCESWEPTAREASOLID",
  2058353004: "IFCFLOWCONTROLLER",
  3907093117: "IFCFLOWCONTROLLERTYPE",
  4278956645: "IFCFLOWFITTING",
  3198132628: "IFCFLOWFITTINGTYPE",
  182646315: "IFCFLOWINSTRUMENT",
  4037862832: "IFCFLOWINSTRUMENTTYPE",
  2188021234: "IFCFLOWMETER",
  3815607619: "IFCFLOWMETERTYPE",
  3132237377: "IFCFLOWMOVINGDEVICE",
  1482959167: "IFCFLOWMOVINGDEVICETYPE",
  987401354: "IFCFLOWSEGMENT",
  1834744321: "IFCFLOWSEGMENTTYPE",
  707683696: "IFCFLOWSTORAGEDEVICE",
  1339347760: "IFCFLOWSTORAGEDEVICETYPE",
  2223149337: "IFCFLOWTERMINAL",
  2297155007: "IFCFLOWTERMINALTYPE",
  3508470533: "IFCFLOWTREATMENTDEVICE",
  3009222698: "IFCFLOWTREATMENTDEVICETYPE",
  900683007: "IFCFOOTING",
  1893162501: "IFCFOOTINGTYPE",
  263784265: "IFCFURNISHINGELEMENT",
  4238390223: "IFCFURNISHINGELEMENTTYPE",
  1509553395: "IFCFURNITURE",
  1268542332: "IFCFURNITURETYPE",
  3493046030: "IFCGEOGRAPHICELEMENT",
  4095422895: "IFCGEOGRAPHICELEMENTTYPE",
  987898635: "IFCGEOMETRICCURVESET",
  3448662350: "IFCGEOMETRICREPRESENTATIONCONTEXT",
  2453401579: "IFCGEOMETRICREPRESENTATIONITEM",
  4142052618: "IFCGEOMETRICREPRESENTATIONSUBCONTEXT",
  3590301190: "IFCGEOMETRICSET",
  3009204131: "IFCGRID",
  852622518: "IFCGRIDAXIS",
  178086475: "IFCGRIDPLACEMENT",
  2706460486: "IFCGROUP",
  812098782: "IFCHALFSPACESOLID",
  3319311131: "IFCHEATEXCHANGER",
  1251058090: "IFCHEATEXCHANGERTYPE",
  2068733104: "IFCHUMIDIFIER",
  1806887404: "IFCHUMIDIFIERTYPE",
  1484403080: "IFCISHAPEPROFILEDEF",
  3905492369: "IFCIMAGETEXTURE",
  3570813810: "IFCINDEXEDCOLOURMAP",
  2571569899: "IFCINDEXEDPOLYCURVE",
  178912537: "IFCINDEXEDPOLYGONALFACE",
  2294589976: "IFCINDEXEDPOLYGONALFACEWITHVOIDS",
  1437953363: "IFCINDEXEDTEXTUREMAP",
  2133299955: "IFCINDEXEDTRIANGLETEXTUREMAP",
  4175244083: "IFCINTERCEPTOR",
  3946677679: "IFCINTERCEPTORTYPE",
  3113134337: "IFCINTERSECTIONCURVE",
  2391368822: "IFCINVENTORY",
  3741457305: "IFCIRREGULARTIMESERIES",
  3020489413: "IFCIRREGULARTIMESERIESVALUE",
  2176052936: "IFCJUNCTIONBOX",
  4288270099: "IFCJUNCTIONBOXTYPE",
  572779678: "IFCLSHAPEPROFILEDEF",
  3827777499: "IFCLABORRESOURCE",
  428585644: "IFCLABORRESOURCETYPE",
  1585845231: "IFCLAGTIME",
  76236018: "IFCLAMP",
  1051575348: "IFCLAMPTYPE",
  2655187982: "IFCLIBRARYINFORMATION",
  3452421091: "IFCLIBRARYREFERENCE",
  4162380809: "IFCLIGHTDISTRIBUTIONDATA",
  629592764: "IFCLIGHTFIXTURE",
  1161773419: "IFCLIGHTFIXTURETYPE",
  1566485204: "IFCLIGHTINTENSITYDISTRIBUTION",
  1402838566: "IFCLIGHTSOURCE",
  125510826: "IFCLIGHTSOURCEAMBIENT",
  2604431987: "IFCLIGHTSOURCEDIRECTIONAL",
  4266656042: "IFCLIGHTSOURCEGONIOMETRIC",
  1520743889: "IFCLIGHTSOURCEPOSITIONAL",
  3422422726: "IFCLIGHTSOURCESPOT",
  1281925730: "IFCLINE",
  3092502836: "IFCLINESEGMENT2D",
  388784114: "IFCLINEARPLACEMENT",
  1154579445: "IFCLINEARPOSITIONINGELEMENT",
  2624227202: "IFCLOCALPLACEMENT",
  1008929658: "IFCLOOP",
  1425443689: "IFCMANIFOLDSOLIDBREP",
  3057273783: "IFCMAPCONVERSION",
  2347385850: "IFCMAPPEDITEM",
  1838606355: "IFCMATERIAL",
  1847130766: "IFCMATERIALCLASSIFICATIONRELATIONSHIP",
  3708119000: "IFCMATERIALCONSTITUENT",
  2852063980: "IFCMATERIALCONSTITUENTSET",
  760658860: "IFCMATERIALDEFINITION",
  2022407955: "IFCMATERIALDEFINITIONREPRESENTATION",
  248100487: "IFCMATERIALLAYER",
  3303938423: "IFCMATERIALLAYERSET",
  1303795690: "IFCMATERIALLAYERSETUSAGE",
  1847252529: "IFCMATERIALLAYERWITHOFFSETS",
  2199411900: "IFCMATERIALLIST",
  2235152071: "IFCMATERIALPROFILE",
  164193824: "IFCMATERIALPROFILESET",
  3079605661: "IFCMATERIALPROFILESETUSAGE",
  3404854881: "IFCMATERIALPROFILESETUSAGETAPERING",
  552965576: "IFCMATERIALPROFILEWITHOFFSETS",
  3265635763: "IFCMATERIALPROPERTIES",
  853536259: "IFCMATERIALRELATIONSHIP",
  1507914824: "IFCMATERIALUSAGEDEFINITION",
  2597039031: "IFCMEASUREWITHUNIT",
  377706215: "IFCMECHANICALFASTENER",
  2108223431: "IFCMECHANICALFASTENERTYPE",
  1437502449: "IFCMEDICALDEVICE",
  1114901282: "IFCMEDICALDEVICETYPE",
  1073191201: "IFCMEMBER",
  1911478936: "IFCMEMBERSTANDARDCASE",
  3181161470: "IFCMEMBERTYPE",
  3368373690: "IFCMETRIC",
  2998442950: "IFCMIRROREDPROFILEDEF",
  2706619895: "IFCMONETARYUNIT",
  2474470126: "IFCMOTORCONNECTION",
  977012517: "IFCMOTORCONNECTIONTYPE",
  1918398963: "IFCNAMEDUNIT",
  3888040117: "IFCOBJECT",
  219451334: "IFCOBJECTDEFINITION",
  3701648758: "IFCOBJECTPLACEMENT",
  2251480897: "IFCOBJECTIVE",
  4143007308: "IFCOCCUPANT",
  590820931: "IFCOFFSETCURVE",
  3388369263: "IFCOFFSETCURVE2D",
  3505215534: "IFCOFFSETCURVE3D",
  2485787929: "IFCOFFSETCURVEBYDISTANCES",
  2665983363: "IFCOPENSHELL",
  3588315303: "IFCOPENINGELEMENT",
  3079942009: "IFCOPENINGSTANDARDCASE",
  4251960020: "IFCORGANIZATION",
  1411181986: "IFCORGANIZATIONRELATIONSHIP",
  643959842: "IFCORIENTATIONEXPRESSION",
  1029017970: "IFCORIENTEDEDGE",
  144952367: "IFCOUTERBOUNDARYCURVE",
  3694346114: "IFCOUTLET",
  2837617999: "IFCOUTLETTYPE",
  1207048766: "IFCOWNERHISTORY",
  2529465313: "IFCPARAMETERIZEDPROFILEDEF",
  2519244187: "IFCPATH",
  1682466193: "IFCPCURVE",
  2382730787: "IFCPERFORMANCEHISTORY",
  3566463478: "IFCPERMEABLECOVERINGPROPERTIES",
  3327091369: "IFCPERMIT",
  2077209135: "IFCPERSON",
  101040310: "IFCPERSONANDORGANIZATION",
  3021840470: "IFCPHYSICALCOMPLEXQUANTITY",
  2483315170: "IFCPHYSICALQUANTITY",
  2226359599: "IFCPHYSICALSIMPLEQUANTITY",
  1687234759: "IFCPILE",
  1158309216: "IFCPILETYPE",
  310824031: "IFCPIPEFITTING",
  804291784: "IFCPIPEFITTINGTYPE",
  3612865200: "IFCPIPESEGMENT",
  4231323485: "IFCPIPESEGMENTTYPE",
  597895409: "IFCPIXELTEXTURE",
  2004835150: "IFCPLACEMENT",
  603570806: "IFCPLANARBOX",
  1663979128: "IFCPLANAREXTENT",
  220341763: "IFCPLANE",
  3171933400: "IFCPLATE",
  1156407060: "IFCPLATESTANDARDCASE",
  4017108033: "IFCPLATETYPE",
  2067069095: "IFCPOINT",
  4022376103: "IFCPOINTONCURVE",
  1423911732: "IFCPOINTONSURFACE",
  2924175390: "IFCPOLYLOOP",
  2775532180: "IFCPOLYGONALBOUNDEDHALFSPACE",
  2839578677: "IFCPOLYGONALFACESET",
  3724593414: "IFCPOLYLINE",
  3740093272: "IFCPORT",
  1946335990: "IFCPOSITIONINGELEMENT",
  3355820592: "IFCPOSTALADDRESS",
  759155922: "IFCPREDEFINEDCOLOUR",
  2559016684: "IFCPREDEFINEDCURVEFONT",
  3727388367: "IFCPREDEFINEDITEM",
  3778827333: "IFCPREDEFINEDPROPERTIES",
  3967405729: "IFCPREDEFINEDPROPERTYSET",
  1775413392: "IFCPREDEFINEDTEXTFONT",
  677532197: "IFCPRESENTATIONITEM",
  2022622350: "IFCPRESENTATIONLAYERASSIGNMENT",
  1304840413: "IFCPRESENTATIONLAYERWITHSTYLE",
  3119450353: "IFCPRESENTATIONSTYLE",
  2417041796: "IFCPRESENTATIONSTYLEASSIGNMENT",
  2744685151: "IFCPROCEDURE",
  569719735: "IFCPROCEDURETYPE",
  2945172077: "IFCPROCESS",
  4208778838: "IFCPRODUCT",
  673634403: "IFCPRODUCTDEFINITIONSHAPE",
  2095639259: "IFCPRODUCTREPRESENTATION",
  3958567839: "IFCPROFILEDEF",
  2802850158: "IFCPROFILEPROPERTIES",
  103090709: "IFCPROJECT",
  653396225: "IFCPROJECTLIBRARY",
  2904328755: "IFCPROJECTORDER",
  3843373140: "IFCPROJECTEDCRS",
  3651124850: "IFCPROJECTIONELEMENT",
  2598011224: "IFCPROPERTY",
  986844984: "IFCPROPERTYABSTRACTION",
  871118103: "IFCPROPERTYBOUNDEDVALUE",
  1680319473: "IFCPROPERTYDEFINITION",
  148025276: "IFCPROPERTYDEPENDENCYRELATIONSHIP",
  4166981789: "IFCPROPERTYENUMERATEDVALUE",
  3710013099: "IFCPROPERTYENUMERATION",
  2752243245: "IFCPROPERTYLISTVALUE",
  941946838: "IFCPROPERTYREFERENCEVALUE",
  1451395588: "IFCPROPERTYSET",
  3357820518: "IFCPROPERTYSETDEFINITION",
  492091185: "IFCPROPERTYSETTEMPLATE",
  3650150729: "IFCPROPERTYSINGLEVALUE",
  110355661: "IFCPROPERTYTABLEVALUE",
  3521284610: "IFCPROPERTYTEMPLATE",
  1482703590: "IFCPROPERTYTEMPLATEDEFINITION",
  738039164: "IFCPROTECTIVEDEVICE",
  2295281155: "IFCPROTECTIVEDEVICETRIPPINGUNIT",
  655969474: "IFCPROTECTIVEDEVICETRIPPINGUNITTYPE",
  1842657554: "IFCPROTECTIVEDEVICETYPE",
  3219374653: "IFCPROXY",
  90941305: "IFCPUMP",
  2250791053: "IFCPUMPTYPE",
  2044713172: "IFCQUANTITYAREA",
  2093928680: "IFCQUANTITYCOUNT",
  931644368: "IFCQUANTITYLENGTH",
  2090586900: "IFCQUANTITYSET",
  3252649465: "IFCQUANTITYTIME",
  2405470396: "IFCQUANTITYVOLUME",
  825690147: "IFCQUANTITYWEIGHT",
  2262370178: "IFCRAILING",
  2893384427: "IFCRAILINGTYPE",
  3024970846: "IFCRAMP",
  3283111854: "IFCRAMPFLIGHT",
  2324767716: "IFCRAMPFLIGHTTYPE",
  1469900589: "IFCRAMPTYPE",
  1232101972: "IFCRATIONALBSPLINECURVEWITHKNOTS",
  683857671: "IFCRATIONALBSPLINESURFACEWITHKNOTS",
  2770003689: "IFCRECTANGLEHOLLOWPROFILEDEF",
  3615266464: "IFCRECTANGLEPROFILEDEF",
  2798486643: "IFCRECTANGULARPYRAMID",
  3454111270: "IFCRECTANGULARTRIMMEDSURFACE",
  3915482550: "IFCRECURRENCEPATTERN",
  2433181523: "IFCREFERENCE",
  4021432810: "IFCREFERENT",
  3413951693: "IFCREGULARTIMESERIES",
  1580146022: "IFCREINFORCEMENTBARPROPERTIES",
  3765753017: "IFCREINFORCEMENTDEFINITIONPROPERTIES",
  979691226: "IFCREINFORCINGBAR",
  2572171363: "IFCREINFORCINGBARTYPE",
  3027567501: "IFCREINFORCINGELEMENT",
  964333572: "IFCREINFORCINGELEMENTTYPE",
  2320036040: "IFCREINFORCINGMESH",
  2310774935: "IFCREINFORCINGMESHTYPE",
  160246688: "IFCRELAGGREGATES",
  3939117080: "IFCRELASSIGNS",
  1683148259: "IFCRELASSIGNSTOACTOR",
  2495723537: "IFCRELASSIGNSTOCONTROL",
  1307041759: "IFCRELASSIGNSTOGROUP",
  1027710054: "IFCRELASSIGNSTOGROUPBYFACTOR",
  4278684876: "IFCRELASSIGNSTOPROCESS",
  2857406711: "IFCRELASSIGNSTOPRODUCT",
  205026976: "IFCRELASSIGNSTORESOURCE",
  1865459582: "IFCRELASSOCIATES",
  4095574036: "IFCRELASSOCIATESAPPROVAL",
  919958153: "IFCRELASSOCIATESCLASSIFICATION",
  2728634034: "IFCRELASSOCIATESCONSTRAINT",
  982818633: "IFCRELASSOCIATESDOCUMENT",
  3840914261: "IFCRELASSOCIATESLIBRARY",
  2655215786: "IFCRELASSOCIATESMATERIAL",
  826625072: "IFCRELCONNECTS",
  1204542856: "IFCRELCONNECTSELEMENTS",
  3945020480: "IFCRELCONNECTSPATHELEMENTS",
  4201705270: "IFCRELCONNECTSPORTTOELEMENT",
  3190031847: "IFCRELCONNECTSPORTS",
  2127690289: "IFCRELCONNECTSSTRUCTURALACTIVITY",
  1638771189: "IFCRELCONNECTSSTRUCTURALMEMBER",
  504942748: "IFCRELCONNECTSWITHECCENTRICITY",
  3678494232: "IFCRELCONNECTSWITHREALIZINGELEMENTS",
  3242617779: "IFCRELCONTAINEDINSPATIALSTRUCTURE",
  886880790: "IFCRELCOVERSBLDGELEMENTS",
  2802773753: "IFCRELCOVERSSPACES",
  2565941209: "IFCRELDECLARES",
  2551354335: "IFCRELDECOMPOSES",
  693640335: "IFCRELDEFINES",
  1462361463: "IFCRELDEFINESBYOBJECT",
  4186316022: "IFCRELDEFINESBYPROPERTIES",
  307848117: "IFCRELDEFINESBYTEMPLATE",
  781010003: "IFCRELDEFINESBYTYPE",
  3940055652: "IFCRELFILLSELEMENT",
  279856033: "IFCRELFLOWCONTROLELEMENTS",
  427948657: "IFCRELINTERFERESELEMENTS",
  3268803585: "IFCRELNESTS",
  1441486842: "IFCRELPOSITIONS",
  750771296: "IFCRELPROJECTSELEMENT",
  1245217292: "IFCRELREFERENCEDINSPATIALSTRUCTURE",
  4122056220: "IFCRELSEQUENCE",
  366585022: "IFCRELSERVICESBUILDINGS",
  3451746338: "IFCRELSPACEBOUNDARY",
  3523091289: "IFCRELSPACEBOUNDARY1STLEVEL",
  1521410863: "IFCRELSPACEBOUNDARY2NDLEVEL",
  1401173127: "IFCRELVOIDSELEMENT",
  478536968: "IFCRELATIONSHIP",
  816062949: "IFCREPARAMETRISEDCOMPOSITECURVESEGMENT",
  1076942058: "IFCREPRESENTATION",
  3377609919: "IFCREPRESENTATIONCONTEXT",
  3008791417: "IFCREPRESENTATIONITEM",
  1660063152: "IFCREPRESENTATIONMAP",
  2914609552: "IFCRESOURCE",
  2943643501: "IFCRESOURCEAPPROVALRELATIONSHIP",
  1608871552: "IFCRESOURCECONSTRAINTRELATIONSHIP",
  2439245199: "IFCRESOURCELEVELRELATIONSHIP",
  1042787934: "IFCRESOURCETIME",
  1856042241: "IFCREVOLVEDAREASOLID",
  3243963512: "IFCREVOLVEDAREASOLIDTAPERED",
  4158566097: "IFCRIGHTCIRCULARCONE",
  3626867408: "IFCRIGHTCIRCULARCYLINDER",
  2016517767: "IFCROOF",
  2781568857: "IFCROOFTYPE",
  2341007311: "IFCROOT",
  2778083089: "IFCROUNDEDRECTANGLEPROFILEDEF",
  448429030: "IFCSIUNIT",
  3053780830: "IFCSANITARYTERMINAL",
  1768891740: "IFCSANITARYTERMINALTYPE",
  1054537805: "IFCSCHEDULINGTIME",
  2157484638: "IFCSEAMCURVE",
  2042790032: "IFCSECTIONPROPERTIES",
  4165799628: "IFCSECTIONREINFORCEMENTPROPERTIES",
  1862484736: "IFCSECTIONEDSOLID",
  1290935644: "IFCSECTIONEDSOLIDHORIZONTAL",
  1509187699: "IFCSECTIONEDSPINE",
  4086658281: "IFCSENSOR",
  1783015770: "IFCSENSORTYPE",
  1329646415: "IFCSHADINGDEVICE",
  4074543187: "IFCSHADINGDEVICETYPE",
  867548509: "IFCSHAPEASPECT",
  3982875396: "IFCSHAPEMODEL",
  4240577450: "IFCSHAPEREPRESENTATION",
  4124623270: "IFCSHELLBASEDSURFACEMODEL",
  3692461612: "IFCSIMPLEPROPERTY",
  3663146110: "IFCSIMPLEPROPERTYTEMPLATE",
  4097777520: "IFCSITE",
  1529196076: "IFCSLAB",
  3127900445: "IFCSLABELEMENTEDCASE",
  3027962421: "IFCSLABSTANDARDCASE",
  2533589738: "IFCSLABTYPE",
  2609359061: "IFCSLIPPAGECONNECTIONCONDITION",
  3420628829: "IFCSOLARDEVICE",
  1072016465: "IFCSOLARDEVICETYPE",
  723233188: "IFCSOLIDMODEL",
  3856911033: "IFCSPACE",
  1999602285: "IFCSPACEHEATER",
  1305183839: "IFCSPACEHEATERTYPE",
  3812236995: "IFCSPACETYPE",
  1412071761: "IFCSPATIALELEMENT",
  710998568: "IFCSPATIALELEMENTTYPE",
  2706606064: "IFCSPATIALSTRUCTUREELEMENT",
  3893378262: "IFCSPATIALSTRUCTUREELEMENTTYPE",
  463610769: "IFCSPATIALZONE",
  2481509218: "IFCSPATIALZONETYPE",
  451544542: "IFCSPHERE",
  4015995234: "IFCSPHERICALSURFACE",
  1404847402: "IFCSTACKTERMINAL",
  3112655638: "IFCSTACKTERMINALTYPE",
  331165859: "IFCSTAIR",
  4252922144: "IFCSTAIRFLIGHT",
  1039846685: "IFCSTAIRFLIGHTTYPE",
  338393293: "IFCSTAIRTYPE",
  682877961: "IFCSTRUCTURALACTION",
  3544373492: "IFCSTRUCTURALACTIVITY",
  2515109513: "IFCSTRUCTURALANALYSISMODEL",
  1179482911: "IFCSTRUCTURALCONNECTION",
  2273995522: "IFCSTRUCTURALCONNECTIONCONDITION",
  1004757350: "IFCSTRUCTURALCURVEACTION",
  4243806635: "IFCSTRUCTURALCURVECONNECTION",
  214636428: "IFCSTRUCTURALCURVEMEMBER",
  2445595289: "IFCSTRUCTURALCURVEMEMBERVARYING",
  2757150158: "IFCSTRUCTURALCURVEREACTION",
  3136571912: "IFCSTRUCTURALITEM",
  1807405624: "IFCSTRUCTURALLINEARACTION",
  2162789131: "IFCSTRUCTURALLOAD",
  385403989: "IFCSTRUCTURALLOADCASE",
  3478079324: "IFCSTRUCTURALLOADCONFIGURATION",
  1252848954: "IFCSTRUCTURALLOADGROUP",
  1595516126: "IFCSTRUCTURALLOADLINEARFORCE",
  609421318: "IFCSTRUCTURALLOADORRESULT",
  2668620305: "IFCSTRUCTURALLOADPLANARFORCE",
  2473145415: "IFCSTRUCTURALLOADSINGLEDISPLACEMENT",
  1973038258: "IFCSTRUCTURALLOADSINGLEDISPLACEMENTDISTORTION",
  1597423693: "IFCSTRUCTURALLOADSINGLEFORCE",
  1190533807: "IFCSTRUCTURALLOADSINGLEFORCEWARPING",
  2525727697: "IFCSTRUCTURALLOADSTATIC",
  3408363356: "IFCSTRUCTURALLOADTEMPERATURE",
  530289379: "IFCSTRUCTURALMEMBER",
  1621171031: "IFCSTRUCTURALPLANARACTION",
  2082059205: "IFCSTRUCTURALPOINTACTION",
  734778138: "IFCSTRUCTURALPOINTCONNECTION",
  1235345126: "IFCSTRUCTURALPOINTREACTION",
  3689010777: "IFCSTRUCTURALREACTION",
  2986769608: "IFCSTRUCTURALRESULTGROUP",
  3657597509: "IFCSTRUCTURALSURFACEACTION",
  1975003073: "IFCSTRUCTURALSURFACECONNECTION",
  3979015343: "IFCSTRUCTURALSURFACEMEMBER",
  2218152070: "IFCSTRUCTURALSURFACEMEMBERVARYING",
  603775116: "IFCSTRUCTURALSURFACEREACTION",
  2830218821: "IFCSTYLEMODEL",
  3958052878: "IFCSTYLEDITEM",
  3049322572: "IFCSTYLEDREPRESENTATION",
  148013059: "IFCSUBCONTRACTRESOURCE",
  4095615324: "IFCSUBCONTRACTRESOURCETYPE",
  2233826070: "IFCSUBEDGE",
  2513912981: "IFCSURFACE",
  699246055: "IFCSURFACECURVE",
  2028607225: "IFCSURFACECURVESWEPTAREASOLID",
  3101698114: "IFCSURFACEFEATURE",
  2809605785: "IFCSURFACEOFLINEAREXTRUSION",
  4124788165: "IFCSURFACEOFREVOLUTION",
  2934153892: "IFCSURFACEREINFORCEMENTAREA",
  1300840506: "IFCSURFACESTYLE",
  3303107099: "IFCSURFACESTYLELIGHTING",
  1607154358: "IFCSURFACESTYLEREFRACTION",
  1878645084: "IFCSURFACESTYLERENDERING",
  846575682: "IFCSURFACESTYLESHADING",
  1351298697: "IFCSURFACESTYLEWITHTEXTURES",
  626085974: "IFCSURFACETEXTURE",
  2247615214: "IFCSWEPTAREASOLID",
  1260650574: "IFCSWEPTDISKSOLID",
  1096409881: "IFCSWEPTDISKSOLIDPOLYGONAL",
  230924584: "IFCSWEPTSURFACE",
  1162798199: "IFCSWITCHINGDEVICE",
  2315554128: "IFCSWITCHINGDEVICETYPE",
  2254336722: "IFCSYSTEM",
  413509423: "IFCSYSTEMFURNITUREELEMENT",
  1580310250: "IFCSYSTEMFURNITUREELEMENTTYPE",
  3071757647: "IFCTSHAPEPROFILEDEF",
  985171141: "IFCTABLE",
  2043862942: "IFCTABLECOLUMN",
  531007025: "IFCTABLEROW",
  812556717: "IFCTANK",
  5716631: "IFCTANKTYPE",
  3473067441: "IFCTASK",
  1549132990: "IFCTASKTIME",
  2771591690: "IFCTASKTIMERECURRING",
  3206491090: "IFCTASKTYPE",
  912023232: "IFCTELECOMADDRESS",
  3824725483: "IFCTENDON",
  2347447852: "IFCTENDONANCHOR",
  3081323446: "IFCTENDONANCHORTYPE",
  3663046924: "IFCTENDONCONDUIT",
  2281632017: "IFCTENDONCONDUITTYPE",
  2415094496: "IFCTENDONTYPE",
  2387106220: "IFCTESSELLATEDFACESET",
  901063453: "IFCTESSELLATEDITEM",
  4282788508: "IFCTEXTLITERAL",
  3124975700: "IFCTEXTLITERALWITHEXTENT",
  1447204868: "IFCTEXTSTYLE",
  1983826977: "IFCTEXTSTYLEFONTMODEL",
  2636378356: "IFCTEXTSTYLEFORDEFINEDFONT",
  1640371178: "IFCTEXTSTYLETEXTMODEL",
  280115917: "IFCTEXTURECOORDINATE",
  1742049831: "IFCTEXTURECOORDINATEGENERATOR",
  2552916305: "IFCTEXTUREMAP",
  1210645708: "IFCTEXTUREVERTEX",
  3611470254: "IFCTEXTUREVERTEXLIST",
  1199560280: "IFCTIMEPERIOD",
  3101149627: "IFCTIMESERIES",
  581633288: "IFCTIMESERIESVALUE",
  1377556343: "IFCTOPOLOGICALREPRESENTATIONITEM",
  1735638870: "IFCTOPOLOGYREPRESENTATION",
  1935646853: "IFCTOROIDALSURFACE",
  3825984169: "IFCTRANSFORMER",
  1692211062: "IFCTRANSFORMERTYPE",
  2595432518: "IFCTRANSITIONCURVESEGMENT2D",
  1620046519: "IFCTRANSPORTELEMENT",
  2097647324: "IFCTRANSPORTELEMENTTYPE",
  2715220739: "IFCTRAPEZIUMPROFILEDEF",
  2916149573: "IFCTRIANGULATEDFACESET",
  1229763772: "IFCTRIANGULATEDIRREGULARNETWORK",
  3593883385: "IFCTRIMMEDCURVE",
  3026737570: "IFCTUBEBUNDLE",
  1600972822: "IFCTUBEBUNDLETYPE",
  1628702193: "IFCTYPEOBJECT",
  3736923433: "IFCTYPEPROCESS",
  2347495698: "IFCTYPEPRODUCT",
  3698973494: "IFCTYPERESOURCE",
  427810014: "IFCUSHAPEPROFILEDEF",
  180925521: "IFCUNITASSIGNMENT",
  630975310: "IFCUNITARYCONTROLELEMENT",
  3179687236: "IFCUNITARYCONTROLELEMENTTYPE",
  4292641817: "IFCUNITARYEQUIPMENT",
  1911125066: "IFCUNITARYEQUIPMENTTYPE",
  4207607924: "IFCVALVE",
  728799441: "IFCVALVETYPE",
  1417489154: "IFCVECTOR",
  2799835756: "IFCVERTEX",
  2759199220: "IFCVERTEXLOOP",
  1907098498: "IFCVERTEXPOINT",
  1530820697: "IFCVIBRATIONDAMPER",
  3956297820: "IFCVIBRATIONDAMPERTYPE",
  2391383451: "IFCVIBRATIONISOLATOR",
  3313531582: "IFCVIBRATIONISOLATORTYPE",
  2769231204: "IFCVIRTUALELEMENT",
  891718957: "IFCVIRTUALGRIDINTERSECTION",
  926996030: "IFCVOIDINGFEATURE",
  2391406946: "IFCWALL",
  4156078855: "IFCWALLELEMENTEDCASE",
  3512223829: "IFCWALLSTANDARDCASE",
  1898987631: "IFCWALLTYPE",
  4237592921: "IFCWASTETERMINAL",
  1133259667: "IFCWASTETERMINALTYPE",
  3304561284: "IFCWINDOW",
  336235671: "IFCWINDOWLININGPROPERTIES",
  512836454: "IFCWINDOWPANELPROPERTIES",
  486154966: "IFCWINDOWSTANDARDCASE",
  1299126871: "IFCWINDOWSTYLE",
  4009809668: "IFCWINDOWTYPE",
  4088093105: "IFCWORKCALENDAR",
  1028945134: "IFCWORKCONTROL",
  4218914973: "IFCWORKPLAN",
  3342526732: "IFCWORKSCHEDULE",
  1236880293: "IFCWORKTIME",
  2543172580: "IFCZSHAPEPROFILEDEF",
  1033361043: "IFCZONE",
};

class JSONPropertyManager extends BasePropertyManager {

  async getItemProperties(modelID, id, recursive = false) {
    return {
      ...this.state.models[modelID].jsonData[id]
    };
  }

  async getSpatialStructure(modelID, includeProperties) {
    const chunks = await this.getSpatialTreeChunks(modelID);
    const projectsIDs = await this.getAllItemsOfType(modelID, IFCPROJECT, false);
    const projectID = projectsIDs[0];
    const project = JSONPropertyManager.newIfcProject(projectID);
    await this.getSpatialNode(modelID, project, chunks, includeProperties);
    return {
      ...project
    };
  }

  async getAllItemsOfType(modelID, type, verbose) {
    const data = this.state.models[modelID].jsonData;
    const typeName = IfcTypesMap[type];
    if (!typeName) {
      throw new Error(`Type not found: ${type}`);
    }
    return this.filterItemsByType(data, typeName, verbose);
  }

  async getProperty(modelID, elementID, recursive = false, propName) {
    const resultIDs = await this.getAllRelatedItemsOfType(modelID, elementID, propName);
    const result = this.getItemsByID(modelID, resultIDs);
    if (recursive) {
      result.forEach(result => this.getReferencesRecursively(modelID, result));
    }
    return result;
  }

  getNodeType(modelID, id) {
    return this.state.models[modelID].jsonData[id].type;
  }

  async getChunks(modelID, chunks, propNames) {
    const relation = await this.getAllItemsOfType(modelID, propNames.name, true);
    relation.forEach(rel => {
      this.saveChunk(chunks, propNames, rel);
    });
  }

  filterItemsByType(data, typeName, verbose) {
    const result = [];
    Object.keys(data).forEach(key => {
      const numKey = parseInt(key);
      if (data[numKey].type.toUpperCase() === typeName) {
        result.push(verbose ? {
          ...data[numKey]
        } : numKey);
      }
    });
    return result;
  }

  async getAllRelatedItemsOfType(modelID, id, propNames) {
    const lines = await this.getAllItemsOfType(modelID, propNames.name, true);
    const IDs = [];
    lines.forEach(line => {
      const isRelated = JSONPropertyManager.isRelated(id, line, propNames);
      if (isRelated)
        this.getRelated(line, propNames, IDs);
    });
    return IDs;
  }

  getItemsByID(modelID, ids) {
    const data = this.state.models[modelID].jsonData;
    const result = [];
    ids.forEach(id => result.push({
      ...data[id]
    }));
    return result;
  }

  getReferencesRecursively(modelID, jsonObject) {
    if (jsonObject == undefined)
      return;
    const keys = Object.keys(jsonObject);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      this.getJSONItem(modelID, jsonObject, key);
    }
  }

  getJSONItem(modelID, jsonObject, key) {
    if (Array.isArray(jsonObject[key])) {
      return this.getMultipleJSONItems(modelID, jsonObject, key);
    }
    if (jsonObject[key] && jsonObject[key].type === 5) {
      jsonObject[key] = this.getItemsByID(modelID, [jsonObject[key].value])[0];
      this.getReferencesRecursively(modelID, jsonObject[key]);
    }
  }

  getMultipleJSONItems(modelID, jsonObject, key) {
    jsonObject[key] = jsonObject[key].map((item) => {
      if (item.type === 5) {
        item = this.getItemsByID(modelID, [item.value])[0];
        this.getReferencesRecursively(modelID, item);
      }
      return item;
    });
  }

}

const geometryTypes = new Set([
  1123145078, 574549367, 1675464909, 2059837836, 3798115385, 32440307, 3125803723, 3207858831,
  2740243338, 2624227202, 4240577450, 3615266464, 3724593414, 220341763, 477187591, 1878645084,
  1300840506, 3303107099, 1607154358, 1878645084, 846575682, 1351298697, 2417041796, 3049322572,
  3331915920, 1416205885, 776857604, 3285139300, 3958052878, 2827736869, 2732653382, 673634403,
  3448662350, 4142052618, 2924175390, 803316827, 2556980723, 1809719519, 2205249479, 807026263,
  3737207727, 1660063152, 2347385850, 3940055652, 2705031697, 3732776249, 2485617015, 2611217952,
  1704287377, 2937912522, 2770003689, 1281925730, 1484403080, 3448662350, 4142052618, 3800577675,
  4006246654, 3590301190, 1383045692, 2775532180, 2047409740, 370225590, 3593883385, 2665983363,
  4124623270, 812098782, 3649129432, 987898635, 1105321065, 3510044353, 1635779807, 2603310189,
  3406155212, 1310608509, 4261334040, 2736907675, 3649129432, 1136057603, 1260505505, 4182860854,
  2713105998, 2898889636, 59481748, 3749851601, 3486308946, 3150382593, 1062206242, 3264961684,
  15328376, 1485152156, 370225590, 1981873012, 2859738748, 45288368, 2614616156, 2732653382,
  775493141, 2147822146, 2601014836, 2629017746, 1186437898, 2367409068, 1213902940, 3632507154,
  3900360178, 476780140, 1472233963, 2804161546, 3008276851, 738692330, 374418227, 315944413,
  3905492369, 3570813810, 2571569899, 178912537, 2294589976, 1437953363, 2133299955, 572779678,
  3092502836, 388784114, 2624227202, 1425443689, 3057273783, 2347385850, 1682466193, 2519244187,
  2839578677, 3958567839, 2513912981, 2830218821, 427810014
]);

class PropertySerializer {

  constructor(webIfc) {
    this.webIfc = webIfc;
  }

  dispose() {
    this.webIfc = null;
  }

  async serializeAllProperties(modelID, maxSize, event) {
    const blobs = [];
    await this.getPropertiesAsBlobs(modelID, blobs, maxSize, event);
    return blobs;
  }

  async getPropertiesAsBlobs(modelID, blobs, maxSize, event) {
    const geometriesIDs = await this.getAllGeometriesIDs(modelID);
    let properties = await this.initializePropertiesObject(modelID);
    const allLinesIDs = await this.webIfc.GetAllLines(modelID);
    const linesCount = allLinesIDs.size();
    let lastEvent = 0.1;
    let counter = 0;
    for (let i = 0; i < linesCount; i++) {
      const id = allLinesIDs.get(i);
      if (!geometriesIDs.has(id)) {
        await this.getItemProperty(modelID, id, properties);
        counter++;
      }
      if (maxSize && counter > maxSize) {
        blobs.push(new Blob([JSON.stringify(properties)], {
          type: 'application/json'
        }));
        properties = {};
        counter = 0;
      }
      if (event && i / linesCount > lastEvent) {
        event(i, linesCount);
        lastEvent += 0.1;
      }
    }
    blobs.push(new Blob([JSON.stringify(properties)], {
      type: 'application/json'
    }));
  }

  async getItemProperty(modelID, id, properties) {
    try {
      const props = await this.webIfc.GetLine(modelID, id);
      if (props.type) {
        props.type = IfcTypesMap[props.type];
      }
      this.formatItemProperties(props);
      properties[id] = props;
    } catch (e) {
      console.log(`There was a problem getting the properties of the item with ID ${id}`);
    }
  }

  formatItemProperties(props) {
    Object.keys(props).forEach((key) => {
      const value = props[key];
      if (value && value.value !== undefined)
        props[key] = value.value;
      else if (Array.isArray(value))
        props[key] = value.map((item) => {
          if (item && item.value)
            return item.value;
          return item;
        });
    });
  }

  async initializePropertiesObject(modelID) {
    return {
      coordinationMatrix: await this.webIfc.GetCoordinationMatrix(modelID),
      globalHeight: await this.getBuildingHeight(modelID)
    };
  }

  async getBuildingHeight(modelID) {
    const building = await this.getBuilding(modelID);
    let placement;
    const siteReference = building.ObjectPlacement.PlacementRelTo;
    if (siteReference)
      placement = siteReference.RelativePlacement.Location;
    else
      placement = building.ObjectPlacement.RelativePlacement.Location;
    const transform = placement.Coordinates.map((coord) => coord.value);
    return transform[2];
  }

  async getBuilding(modelID) {
    const allBuildingsIDs = await this.webIfc.GetLineIDsWithType(modelID, IFCBUILDING);
    const buildingID = allBuildingsIDs.get(0);
    return this.webIfc.GetLine(modelID, buildingID, true);
  }

  async getAllGeometriesIDs(modelID) {
    const geometriesIDs = new Set();
    const geomTypesArray = Array.from(geometryTypes);
    for (let i = 0; i < geomTypesArray.length; i++) {
      const category = geomTypesArray[i];
      const ids = await this.webIfc.GetLineIDsWithType(modelID, category);
      const idsSize = ids.size();
      for (let j = 0; j < idsSize; j++) {
        geometriesIDs.add(ids.get(j));
      }
    }
    return geometriesIDs;
  }

}

class PropertyManager {

  constructor(state) {
    this.state = state;
    this.webIfcProps = new WebIfcPropertyManager(state);
    this.jsonProps = new JSONPropertyManager(state);
    this.currentProps = this.webIfcProps;
    this.serializer = new PropertySerializer(this.state.api);
  }

  getExpressId(geometry, faceIndex) {
    if (!geometry.index)
      throw new Error('Geometry does not have index information.');
    const geoIndex = geometry.index.array;
    return geometry.attributes[IdAttrName].getX(geoIndex[3 * faceIndex]);
  }

  async getItemProperties(modelID, elementID, recursive = false) {
    this.updateCurrentProps();
    return this.currentProps.getItemProperties(modelID, elementID, recursive);
  }

  async getAllItemsOfType(modelID, type, verbose) {
    this.updateCurrentProps();
    return this.currentProps.getAllItemsOfType(modelID, type, verbose);
  }

  async getPropertySets(modelID, elementID, recursive = false) {
    this.updateCurrentProps();
    return this.currentProps.getPropertySets(modelID, elementID, recursive);
  }

  async getTypeProperties(modelID, elementID, recursive = false) {
    this.updateCurrentProps();
    return this.currentProps.getTypeProperties(modelID, elementID, recursive);
  }

  async getMaterialsProperties(modelID, elementID, recursive = false) {
    this.updateCurrentProps();
    return this.currentProps.getMaterialsProperties(modelID, elementID, recursive);
  }

  async getSpatialStructure(modelID, includeProperties) {
    this.updateCurrentProps();
    if (!this.state.useJSON && includeProperties) {
      console.warn('Including properties in getSpatialStructure with the JSON workflow disabled can lead to poor performance.');
    }
    return await this.currentProps.getSpatialStructure(modelID, includeProperties);
  }

  updateCurrentProps() {
    this.currentProps = this.state.useJSON ? this.jsonProps : this.webIfcProps;
  }

}

class TypeManager {

  constructor(state) {
    this.state = state;
    this.state = state;
  }

  async getAllTypes(worker) {
    for (let modelID in this.state.models) {
      if (this.state.models.hasOwnProperty(modelID)) {
        const types = this.state.models[modelID].types;
        if (Object.keys(types).length == 0) {
          await this.getAllTypesOfModel(parseInt(modelID), worker);
        }
      }
    }
  }

  async getAllTypesOfModel(modelID, worker) {
    const result = {};
    const elements = Object.keys(IfcElements).map((e) => parseInt(e));
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      const lines = await this.state.api.GetLineIDsWithType(modelID, element);
      const size = lines.size();
      for (let i = 0; i < size; i++)
        result[lines.get(i)] = element;
    }
    if (this.state.worker.active && worker) {
      await worker.workerState.updateModelStateTypes(modelID, result);
    }
    this.state.models[modelID].types = result;
  }

}

class BvhManager {

  initializeMeshBVH(computeBoundsTree, disposeBoundsTree, acceleratedRaycast) {
    this.computeBoundsTree = computeBoundsTree;
    this.disposeBoundsTree = disposeBoundsTree;
    this.acceleratedRaycast = acceleratedRaycast;
    this.setupThreeMeshBVH();
  }

  applyThreeMeshBVH(geometry) {
    if (this.computeBoundsTree)
      geometry.computeBoundsTree();
  }

  setupThreeMeshBVH() {
    if (!this.computeBoundsTree || !this.disposeBoundsTree || !this.acceleratedRaycast)
      return;
    BufferGeometry.prototype.computeBoundsTree = this.computeBoundsTree;
    BufferGeometry.prototype.disposeBoundsTree = this.disposeBoundsTree;
    Mesh.prototype.raycast = this.acceleratedRaycast;
  }

}

var WorkerActions;
(function(WorkerActions) {
  WorkerActions["updateStateUseJson"] = "updateStateUseJson";
  WorkerActions["updateStateWebIfcSettings"] = "updateStateWebIfcSettings";
  WorkerActions["updateModelStateTypes"] = "updateModelStateTypes";
  WorkerActions["updateModelStateJsonData"] = "updateModelStateJsonData";
  WorkerActions["loadJsonDataFromWorker"] = "loadJsonDataFromWorker";
  WorkerActions["dispose"] = "dispose";
  WorkerActions["Close"] = "Close";
  WorkerActions["DisposeWebIfc"] = "DisposeWebIfc";
  WorkerActions["Init"] = "Init";
  WorkerActions["OpenModel"] = "OpenModel";
  WorkerActions["CreateModel"] = "CreateModel";
  WorkerActions["ExportFileAsIFC"] = "ExportFileAsIFC";
  WorkerActions["GetGeometry"] = "GetGeometry";
  WorkerActions["GetLine"] = "GetLine";
  WorkerActions["GetAndClearErrors"] = "GetAndClearErrors";
  WorkerActions["WriteLine"] = "WriteLine";
  WorkerActions["FlattenLine"] = "FlattenLine";
  WorkerActions["GetRawLineData"] = "GetRawLineData";
  WorkerActions["WriteRawLineData"] = "WriteRawLineData";
  WorkerActions["GetLineIDsWithType"] = "GetLineIDsWithType";
  WorkerActions["GetAllLines"] = "GetAllLines";
  WorkerActions["SetGeometryTransformation"] = "SetGeometryTransformation";
  WorkerActions["GetCoordinationMatrix"] = "GetCoordinationMatrix";
  WorkerActions["GetVertexArray"] = "GetVertexArray";
  WorkerActions["GetIndexArray"] = "GetIndexArray";
  WorkerActions["getSubArray"] = "getSubArray";
  WorkerActions["CloseModel"] = "CloseModel";
  WorkerActions["StreamAllMeshes"] = "StreamAllMeshes";
  WorkerActions["StreamAllMeshesWithTypes"] = "StreamAllMeshesWithTypes";
  WorkerActions["IsModelOpen"] = "IsModelOpen";
  WorkerActions["LoadAllGeometry"] = "LoadAllGeometry";
  WorkerActions["GetFlatMesh"] = "GetFlatMesh";
  WorkerActions["SetWasmPath"] = "SetWasmPath";
  WorkerActions["parse"] = "parse";
  WorkerActions["setupOptionalCategories"] = "setupOptionalCategories";
  WorkerActions["getExpressId"] = "getExpressId";
  WorkerActions["initializeProperties"] = "initializeProperties";
  WorkerActions["getAllItemsOfType"] = "getAllItemsOfType";
  WorkerActions["getItemProperties"] = "getItemProperties";
  WorkerActions["getMaterialsProperties"] = "getMaterialsProperties";
  WorkerActions["getPropertySets"] = "getPropertySets";
  WorkerActions["getSpatialStructure"] = "getSpatialStructure";
  WorkerActions["getTypeProperties"] = "getTypeProperties";
})(WorkerActions || (WorkerActions = {}));
var WorkerAPIs;
(function(WorkerAPIs) {
  WorkerAPIs["workerState"] = "workerState";
  WorkerAPIs["webIfc"] = "webIfc";
  WorkerAPIs["properties"] = "properties";
  WorkerAPIs["parser"] = "parser";
})(WorkerAPIs || (WorkerAPIs = {}));

class Vector {

  constructor(vector) {
    this._data = {};
    this._size = vector.size;
    const keys = Object.keys(vector).filter((key) => key.indexOf('size') === -1).map(key => parseInt(key));
    keys.forEach((key) => this._data[key] = vector[key]);
  }

  size() {
    return this._size;
  }

  get(index) {
    return this._data[index];
  }

}

class IfcGeometry {

  constructor(vector) {
    this._GetVertexData = vector.GetVertexData;
    this._GetVertexDataSize = vector.GetVertexDataSize;
    this._GetIndexData = vector.GetIndexData;
    this._GetIndexDataSize = vector.GetIndexDataSize;
  }

  GetVertexData() {
    return this._GetVertexData;
  }

  GetVertexDataSize() {
    return this._GetVertexDataSize;
  }

  GetIndexData() {
    return this._GetIndexData;
  }

  GetIndexDataSize() {
    return this._GetIndexDataSize;
  }

}

class FlatMesh {

  constructor(serializer, flatMesh) {
    this.expressID = flatMesh.expressID;
    this.geometries = serializer.reconstructVector(flatMesh.geometries);
  }

}

class FlatMeshVector {

  constructor(serializer, vector) {
    this._data = {};
    this._size = vector.size;
    const keys = Object.keys(vector).filter((key) => key.indexOf('size') === -1).map(key => parseInt(key));
    keys.forEach(key => this._data[key] = serializer.reconstructFlatMesh(vector[key]));
  }

  size() {
    return this._size;
  }

  get(index) {
    return this._data[index];
  }

}

class SerializedMaterial {

  constructor(material) {
    this.color = [material.color.r, material.color.g, material.color.b];
    this.opacity = material.opacity;
    this.transparent = material.transparent;
  }

}

class MaterialReconstructor {

  static new(material) {
    return new MeshLambertMaterial({
      color: new Color$1(material.color[0], material.color[1], material.color[2]),
      opacity: material.opacity,
      transparent: material.transparent,
      side: DoubleSide
    });
  }

}

class SerializedGeometry {

  constructor(geometry) {
    var _a,
      _b,
      _c,
      _d;
    this.position = ((_a = geometry.attributes.position) === null || _a === void 0 ? void 0 : _a.array) || [];
    this.normal = ((_b = geometry.attributes.normal) === null || _b === void 0 ? void 0 : _b.array) || [];
    this.expressID = ((_c = geometry.attributes.expressID) === null || _c === void 0 ? void 0 : _c.array) || [];
    this.index = ((_d = geometry.index) === null || _d === void 0 ? void 0 : _d.array) || [];
    this.groups = geometry.groups;
  }

}

class GeometryReconstructor {

  static new(serialized) {
    const geom = new BufferGeometry();
    GeometryReconstructor.set(geom, 'expressID', new Uint32Array(serialized.expressID), 1);
    GeometryReconstructor.set(geom, 'position', new Float32Array(serialized.position), 3);
    GeometryReconstructor.set(geom, 'normal', new Float32Array(serialized.normal), 3);
    geom.setIndex(Array.from(serialized.index));
    geom.groups = serialized.groups;
    return geom;
  }

  static set(geom, name, data, size) {
    if (data.length > 0) {
      geom.setAttribute(name, new BufferAttribute$1(data, size));
    }
  }

}

class SerializedMesh {

  constructor(model) {
    this.materials = [];
    this.modelID = model.modelID;
    this.geometry = new SerializedGeometry(model.geometry);
    if (Array.isArray(model.material)) {
      model.material.forEach(mat => {
        this.materials.push(new SerializedMaterial(mat));
      });
    } else {
      this.materials.push(new SerializedMaterial(model.material));
    }
  }

}

class MeshReconstructor {

  static new(serialized) {
    const model = new IFCModel();
    model.modelID = serialized.modelID;
    model.geometry = GeometryReconstructor.new(serialized.geometry);
    MeshReconstructor.getMaterials(serialized, model);
    return model;
  }

  static getMaterials(serialized, model) {
    model.material = [];
    const mats = model.material;
    serialized.materials.forEach(mat => {
      mats.push(MaterialReconstructor.new(mat));
    });
  }

}

class Serializer {

  serializeVector(vector) {
    const size = vector.size();
    const serialized = {
      size
    };
    for (let i = 0; i < size; i++) {
      serialized[i] = vector.get(i);
    }
    return serialized;
  }

  reconstructVector(vector) {
    return new Vector(vector);
  }

  serializeIfcGeometry(geometry) {
    const GetVertexData = geometry.GetVertexData();
    const GetVertexDataSize = geometry.GetVertexDataSize();
    const GetIndexData = geometry.GetIndexData();
    const GetIndexDataSize = geometry.GetIndexDataSize();
    return {
      GetVertexData,
      GetVertexDataSize,
      GetIndexData,
      GetIndexDataSize
    };
  }

  reconstructIfcGeometry(geometry) {
    return new IfcGeometry(geometry);
  }

  serializeFlatMesh(flatMesh) {
    return {
      expressID: flatMesh.expressID,
      geometries: this.serializeVector(flatMesh.geometries)
    };
  }

  reconstructFlatMesh(flatMesh) {
    return new FlatMesh(this, flatMesh);
  }

  serializeFlatMeshVector(vector) {
    const size = vector.size();
    const serialized = {
      size
    };
    for (let i = 0; i < size; i++) {
      const flatMesh = vector.get(i);
      serialized[i] = this.serializeFlatMesh(flatMesh);
    }
    return serialized;
  }

  reconstructFlatMeshVector(vector) {
    return new FlatMeshVector(this, vector);
  }

  serializeIfcModel(model) {
    return new SerializedMesh(model);
  }

  reconstructIfcModel(model) {
    return MeshReconstructor.new(model);
  }

}

class PropertyHandler {

  constructor(handler) {
    this.handler = handler;
    this.API = WorkerAPIs.properties;
  }

  getExpressId(geometry, faceIndex) {
    if (!geometry.index)
      throw new Error('Geometry does not have index information.');
    const geoIndex = geometry.index.array;
    return geometry.attributes[IdAttrName].getX(geoIndex[3 * faceIndex]);
  }

  getAllItemsOfType(modelID, type, verbose) {
    return this.handler.request(this.API, WorkerActions.getAllItemsOfType, {
      modelID,
      type,
      verbose
    });
  }

  getItemProperties(modelID, elementID, recursive) {
    return this.handler.request(this.API, WorkerActions.getItemProperties, {
      modelID,
      elementID,
      recursive
    });
  }

  getMaterialsProperties(modelID, elementID, recursive) {
    return this.handler.request(this.API, WorkerActions.getMaterialsProperties, {
      modelID,
      elementID,
      recursive
    });
  }

  getPropertySets(modelID, elementID, recursive) {
    return this.handler.request(this.API, WorkerActions.getPropertySets, {
      modelID,
      elementID,
      recursive
    });
  }

  getTypeProperties(modelID, elementID, recursive) {
    return this.handler.request(this.API, WorkerActions.getTypeProperties, {
      modelID,
      elementID,
      recursive
    });
  }

  getSpatialStructure(modelID, includeProperties) {
    return this.handler.request(this.API, WorkerActions.getSpatialStructure, {
      modelID,
      includeProperties
    });
  }

}

class WebIfcHandler {

  constructor(handler, serializer) {
    this.handler = handler;
    this.serializer = serializer;
    this.API = WorkerAPIs.webIfc;
  }

  async Init() {
    this.wasmModule = true;
    return this.handler.request(this.API, WorkerActions.Init);
  }

  async OpenModel(data, settings) {
    return this.handler.request(this.API, WorkerActions.OpenModel, {
      data,
      settings
    });
  }

  async CreateModel(settings) {
    return this.handler.request(this.API, WorkerActions.CreateModel, {
      settings
    });
  }

  async ExportFileAsIFC(modelID) {
    return this.handler.request(this.API, WorkerActions.ExportFileAsIFC, {
      modelID
    });
  }

  async GetGeometry(modelID, geometryExpressID) {
    this.handler.serializeHandlers[this.handler.requestID] = (geom) => {
      return this.serializer.reconstructIfcGeometry(geom);
    };
    return this.handler.request(this.API, WorkerActions.GetGeometry, {
      modelID,
      geometryExpressID
    });
  }

  async GetLine(modelID, expressID, flatten) {
    return this.handler.request(this.API, WorkerActions.GetLine, {
      modelID,
      expressID,
      flatten
    });
  }

  async GetAndClearErrors(modelID) {
    this.handler.serializeHandlers[this.handler.requestID] = (vector) => {
      return this.serializer.reconstructVector(vector);
    };
    return this.handler.request(this.API, WorkerActions.GetAndClearErrors, {
      modelID
    });
  }

  async WriteLine(modelID, lineObject) {
    return this.handler.request(this.API, WorkerActions.WriteLine, {
      modelID,
      lineObject
    });
  }

  async FlattenLine(modelID, line) {
    return this.handler.request(this.API, WorkerActions.FlattenLine, {
      modelID,
      line
    });
  }

  async GetRawLineData(modelID, expressID) {
    return this.handler.request(this.API, WorkerActions.GetRawLineData, {
      modelID,
      expressID
    });
  }

  async WriteRawLineData(modelID, data) {
    return this.handler.request(this.API, WorkerActions.WriteRawLineData, {
      modelID,
      data
    });
  }

  async GetLineIDsWithType(modelID, type) {
    this.handler.serializeHandlers[this.handler.requestID] = (vector) => {
      return this.serializer.reconstructVector(vector);
    };
    return this.handler.request(this.API, WorkerActions.GetLineIDsWithType, {
      modelID,
      type
    });
  }

  async GetAllLines(modelID) {
    this.handler.serializeHandlers[this.handler.requestID] = (vector) => {
      return this.serializer.reconstructVector(vector);
    };
    return this.handler.request(this.API, WorkerActions.GetAllLines, {
      modelID
    });
  }

  async SetGeometryTransformation(modelID, transformationMatrix) {
    return this.handler.request(this.API, WorkerActions.SetGeometryTransformation, {
      modelID,
      transformationMatrix
    });
  }

  async GetCoordinationMatrix(modelID) {
    return this.handler.request(this.API, WorkerActions.GetCoordinationMatrix, {
      modelID
    });
  }

  async GetVertexArray(ptr, size) {
    return this.handler.request(this.API, WorkerActions.GetVertexArray, {
      ptr,
      size
    });
  }

  async GetIndexArray(ptr, size) {
    return this.handler.request(this.API, WorkerActions.GetIndexArray, {
      ptr,
      size
    });
  }

  async getSubArray(heap, startPtr, sizeBytes) {
    return this.handler.request(this.API, WorkerActions.getSubArray, {
      heap,
      startPtr,
      sizeBytes
    });
  }

  async CloseModel(modelID) {
    return this.handler.request(this.API, WorkerActions.CloseModel, {
      modelID
    });
  }

  async StreamAllMeshes(modelID, meshCallback) {
    this.handler.callbackHandlers[this.handler.requestID] = {
      action: meshCallback,
      serializer: this.serializer.reconstructFlatMesh
    };
    return this.handler.request(this.API, WorkerActions.StreamAllMeshes, {
      modelID
    });
  }

  async StreamAllMeshesWithTypes(modelID, types, meshCallback) {
    this.handler.callbackHandlers[this.handler.requestID] = {
      action: meshCallback,
      serializer: this.serializer.reconstructFlatMesh
    };
    return this.handler.request(this.API, WorkerActions.StreamAllMeshesWithTypes, {
      modelID,
      types
    });
  }

  async IsModelOpen(modelID) {
    return this.handler.request(this.API, WorkerActions.IsModelOpen, {
      modelID
    });
  }

  async LoadAllGeometry(modelID) {
    this.handler.serializeHandlers[this.handler.requestID] = (vector) => {
      return this.serializer.reconstructFlatMeshVector(vector);
    };
    return this.handler.request(this.API, WorkerActions.LoadAllGeometry, {
      modelID
    });
  }

  async GetFlatMesh(modelID, expressID) {
    this.handler.serializeHandlers[this.handler.requestID] = (flatMesh) => {
      return this.serializer.reconstructFlatMesh(flatMesh);
    };
    return this.handler.request(this.API, WorkerActions.GetFlatMesh, {
      modelID,
      expressID
    });
  }

  async SetWasmPath(path) {
    return this.handler.request(this.API, WorkerActions.SetWasmPath, {
      path
    });
  }

}

class WorkerStateHandler {

  constructor(handler) {
    this.handler = handler;
    this.API = WorkerAPIs.workerState;
    this.state = this.handler.state;
  }

  async updateStateUseJson() {
    const useJson = this.state.useJSON;
    return this.handler.request(this.API, WorkerActions.updateStateUseJson, {
      useJson
    });
  }

  async updateStateWebIfcSettings() {
    const webIfcSettings = this.state.webIfcSettings;
    return this.handler.request(this.API, WorkerActions.updateStateWebIfcSettings, {
      webIfcSettings
    });
  }

  async updateModelStateTypes(modelID, types) {
    return this.handler.request(this.API, WorkerActions.updateModelStateTypes, {
      modelID,
      types
    });
  }

  async updateModelStateJsonData(modelID, jsonData) {
    return this.handler.request(this.API, WorkerActions.updateModelStateJsonData, {
      modelID,
      jsonData
    });
  }

  async loadJsonDataFromWorker(modelID, path) {
    return this.handler.request(this.API, WorkerActions.loadJsonDataFromWorker, {
      modelID,
      path
    });
  }

}

var DBOperation;
(function(DBOperation) {
  DBOperation[DBOperation["transferIfcModel"] = 0] = "transferIfcModel";
  DBOperation[DBOperation["transferIndividualItems"] = 1] = "transferIndividualItems";
})(DBOperation || (DBOperation = {}));

class IndexedDatabase {

  async save(item, id) {
    const open = IndexedDatabase.openOrCreateDB(id);
    this.createSchema(open, id);
    return new Promise((resolve, reject) => {
      open.onsuccess = () => this.saveItem(item, open, id, resolve);
    });
  }

  async load(id) {
    const open = IndexedDatabase.openOrCreateDB(id);
    return new Promise((resolve, reject) => {
      open.onsuccess = () => this.loadItem(open, id, resolve);
    });
  }

  createSchema(open, id) {
    open.onupgradeneeded = function() {
      const db = open.result;
      db.createObjectStore(id.toString(), {
        keyPath: "id"
      });
    };
  }

  saveItem(item, open, id, resolve) {
    const {db, tx, store} = IndexedDatabase.getDBItems(open, id);
    item.id = id;
    store.put(item);
    tx.oncomplete = () => IndexedDatabase.closeDB(db, tx, resolve);
  }

  loadItem(open, id, resolve) {
    const {db, tx, store} = IndexedDatabase.getDBItems(open, id);
    const item = store.get(id);
    const callback = () => {
      delete item.result.id;
      resolve(item.result);
    };
    tx.oncomplete = () => IndexedDatabase.closeDB(db, tx, callback);
  }

  static getDBItems(open, id) {
    const db = open.result;
    const tx = db.transaction(id.toString(), "readwrite");
    const store = tx.objectStore(id.toString());
    return {
      db,
      tx,
      store
    };
  }

  static openOrCreateDB(id) {
    return indexedDB.open(id.toString(), 1);
  }

  static closeDB(db, tx, resolve) {
    db.close();
    resolve("success");
  }

}

class ParserHandler {

  constructor(handler, serializer, BVH, IDB) {
    this.handler = handler;
    this.serializer = serializer;
    this.BVH = BVH;
    this.IDB = IDB;
    this.optionalCategories = {
      [IFCSPACE]: true,
      [IFCOPENINGELEMENT]: false
    };
    this.API = WorkerAPIs.parser;
  }

  async setupOptionalCategories(config) {
    this.optionalCategories = config;
    return this.handler.request(this.API, WorkerActions.setupOptionalCategories, {
      config
    });
  }

  async parse(buffer, coordinationMatrix) {
    this.handler.onprogressHandlers[this.handler.requestID] = (progress) => {
      if (this.handler.state.onProgress)
        this.handler.state.onProgress(progress);
    };
    this.handler.serializeHandlers[this.handler.requestID] = async (result) => {
      this.updateState(result.modelID);
      return this.getModel();
    };
    return this.handler.request(this.API, WorkerActions.parse, {
      buffer,
      coordinationMatrix
    });
  }

  getAndClearErrors(_modelId) {}

  updateState(modelID) {
    this.handler.state.models[modelID] = {
      modelID: modelID,
      mesh: {},
      types: {},
      jsonData: {}
    };
  }

  async getModel() {
    const serializedModel = await this.IDB.load(DBOperation.transferIfcModel);
    const model = this.serializer.reconstructIfcModel(serializedModel);
    this.BVH.applyThreeMeshBVH(model.geometry);
    this.handler.state.models[model.modelID].mesh = model;
    return model;
  }

}

class IFCWorkerHandler {

  constructor(state, BVH) {
    this.state = state;
    this.BVH = BVH;
    this.requestID = 0;
    this.rejectHandlers = {};
    this.resolveHandlers = {};
    this.serializeHandlers = {};
    this.callbackHandlers = {};
    this.onprogressHandlers = {};
    this.serializer = new Serializer();
    this.IDB = new IndexedDatabase();
    this.workerPath = this.state.worker.path;
    this.ifcWorker = new Worker(this.workerPath);
    this.ifcWorker.onmessage = (data) => this.handleResponse(data);
    this.properties = new PropertyHandler(this);
    this.parser = new ParserHandler(this, this.serializer, this.BVH, this.IDB);
    this.webIfc = new WebIfcHandler(this, this.serializer);
    this.workerState = new WorkerStateHandler(this);
  }

  request(worker, action, args) {
    const data = {
      worker,
      action,
      args,
      id: this.requestID,
      result: undefined,
      onProgress: false
    };
    return new Promise((resolve, reject) => {
      this.resolveHandlers[this.requestID] = resolve;
      this.rejectHandlers[this.requestID] = reject;
      this.requestID++;
      this.ifcWorker.postMessage(data);
    });
  }

  async terminate() {
    await this.request(WorkerAPIs.workerState, WorkerActions.dispose);
    await this.request(WorkerAPIs.webIfc, WorkerActions.DisposeWebIfc);
    this.ifcWorker.terminate();
  }

  async Close() {
    await this.request(WorkerAPIs.webIfc, WorkerActions.Close);
  }

  handleResponse(event) {
    const data = event.data;
    if (data.onProgress) {
      this.resolveOnProgress(data);
      return;
    }
    this.callHandlers(data);
    delete this.resolveHandlers[data.id];
    delete this.rejectHandlers[data.id];
    delete this.onprogressHandlers[data.id];
  }

  callHandlers(data) {
    try {
      this.resolveSerializations(data);
      this.resolveCallbacks(data);
      this.resolveHandlers[data.id](data.result);
    } catch (error) {
      this.rejectHandlers[data.id](error);
    }
  }

  resolveOnProgress(data) {
    if (this.onprogressHandlers[data.id]) {
      data.result = this.onprogressHandlers[data.id](data.result);
    }
  }

  resolveSerializations(data) {
    if (this.serializeHandlers[data.id]) {
      data.result = this.serializeHandlers[data.id](data.result);
      delete this.serializeHandlers[data.id];
    }
  }

  resolveCallbacks(data) {
    if (this.callbackHandlers[data.id]) {
      let callbackParameter = data.result;
      if (this.callbackHandlers[data.id].serializer) {
        callbackParameter = this.callbackHandlers[data.id].serializer(data.result);
      }
      this.callbackHandlers[data.id].action(callbackParameter);
    }
  }

}

class MemoryCleaner {

  constructor(state) {
    this.state = state;
  }

  async dispose() {
    Object.keys(this.state.models).forEach(modelID => {
      const model = this.state.models[parseInt(modelID, 10)];
      model.mesh.removeFromParent();
      const geom = model.mesh.geometry;
      if (geom.disposeBoundsTree)
        geom.disposeBoundsTree();
      geom.dispose();
      if (!Array.isArray(model.mesh.material))
        model.mesh.material.dispose();
      else
        model.mesh.material.forEach(mat => mat.dispose());
      model.mesh = null;
      model.types = null;
      model.jsonData = null;
    });
    this.state.api = null;
    this.state.models = null;
  }

}

class IFCUtils {

  constructor(state) {
    this.state = state;
    this.map = {};
  }

  getMapping() {
    this.map = this.reverseElementMapping(IfcTypesMap);
  }

  releaseMapping() {
    this.map = {};
  }

  reverseElementMapping(obj) {
    let reverseElement = {};
    Object.keys(obj).forEach(key => {
      reverseElement[obj[key]] = key;
    });
    return reverseElement;
  }

  isA(entity, entity_class) {
    var test = false;
    if (entity_class) {
      if (IfcTypesMap[entity.type] === entity_class.toUpperCase()) {
        test = true;
      }
      return test;
    } else {
      return IfcTypesMap[entity.type];
    }
  }

  async byId(modelID, id) {
    return this.state.api.GetLine(modelID, id);
  }

  async idsByType(modelID, entity_class) {
    this.getMapping();
    let entities_ids = await this.state.api.GetLineIDsWithType(modelID, Number(this.map[entity_class.toUpperCase()]));
    this.releaseMapping();
    return entities_ids;
  }

  async byType(modelID, entity_class) {
    let entities_ids = await this.idsByType(modelID, entity_class);
    if (entities_ids !== null) {
      this.getMapping();
      let items = [];
      for (let i = 0; i < entities_ids.size(); i++) {
        let entity = await this.byId(modelID, entities_ids.get(i));
        items.push(entity);
      }
      this.releaseMapping();
      return items;
    }
  }

}

class Data {

  constructor(state) {
    this.state = state;
    this.isLoaded = false;
    this.workPlans = {};
    this.workSchedules = {};
    this.workCalendars = {};
    this.workTimes = {};
    this.recurrencePatterns = {};
    this.timePeriods = {};
    this.tasks = {};
    this.taskTimes = {};
    this.lagTimes = {};
    this.sequences = {};
    this.utils = new IFCUtils(this.state);
  }

  async load(modelID) {
    await this.loadTasks(modelID);
    await this.loadWorkSchedules(modelID);
    await this.loadWorkCalendars(modelID);
    await this.loadWorkTimes(modelID);
    await this.loadTimePeriods(modelID);
    this.isLoaded = true;
  }

  async loadWorkSchedules(modelID) {
    let workSchedules = await this.utils.byType(modelID, "IfcWorkSchedule");
    for (let i = 0; i < workSchedules.length; i++) {
      let workSchedule = workSchedules[i];
      this.workSchedules[workSchedule.expressID] = {
        "Id": workSchedule.expressID,
        "Name": workSchedule.Name.value,
        "Description": ((workSchedule.Description) ? workSchedule.Description.value : ""),
        "Creators": [],
        "CreationDate": ((workSchedule.CreationDate) ? workSchedule.CreationDate.value : ""),
        "StartTime": ((workSchedule.StartTime) ? workSchedule.StartTime.value : ""),
        "FinishTime": ((workSchedule.FinishTime) ? workSchedule.FinishTime.value : ""),
        "TotalFloat": ((workSchedule.TotalFloat) ? workSchedule.TotalFloat.value : ""),
        "RelatedObjects": [],
      };
    }
    this.loadWorkScheduleRelatedObjects(modelID);
  }

  async loadWorkScheduleRelatedObjects(modelID) {
    let relsControls = await this.utils.byType(modelID, "IfcRelAssignsToControl");
    for (let i = 0; i < relsControls.length; i++) {
      let relControls = relsControls[i];
      let relatingControl = await this.utils.byId(modelID, relControls.RelatingControl.value);
      let relatedObjects = relControls.RelatedObjects;
      if (this.utils.isA(relatingControl, "IfcWorkSchedule")) {
        for (var objectIndex = 0; objectIndex < relatedObjects.length; objectIndex++) {
          this.workSchedules[relatingControl.expressID]["RelatedObjects"].push(relatedObjects[objectIndex].value);
        }
      }
    }
  }

  async loadTasks(modelID) {
    let tasks = await this.utils.byType(modelID, "IfcTask");
    for (let i = 0; i < tasks.length; i++) {
      let task = tasks[i];
      this.tasks[task.expressID] = {
        "Id": task.expressID,
        "Name": ((task.Name) ? task.Name.value : ""),
        "PredefinedType": ((task.PredefinedType) ? task.PredefinedType.value : ""),
        "TaskTime": ((task.TaskTime) ? await this.utils.byId(modelID, task.TaskTime.value) : ""),
        "Identification": ((task.Identification) ? task.Identification.value : ""),
        "IsMilestone": ((task.IsMilestone) ? task.IsMilestone.value : ""),
        "IsPredecessorTo": [],
        "IsSucessorFrom": [],
        "Inputs": [],
        "Resources": [],
        "Outputs": [],
        "Controls": [],
        "Nests": [],
        "IsNestedBy": [],
        "OperatesOn": [],
        "HasAssignmentsWorkCalendars": [],
      };
    }
    await this.loadTaskSequence(modelID);
    await this.loadTaskOutputs(modelID);
    await this.loadTaskNesting(modelID);
    await this.loadTaskOperations(modelID);
    await this.loadAssignementsWorkCalendar(modelID);
  }

  async loadTaskSequence(modelID) {
    let relsSequence = await this.utils.idsByType(modelID, "IfcRelSequence");
    for (let i = 0; i < relsSequence.size(); i++) {
      let relSequenceId = relsSequence.get(i);
      if (relSequenceId !== 0) {
        let relSequence = await this.utils.byId(modelID, relSequenceId);
        let related_process = relSequence.RelatedProcess.value;
        let relatingProcess = relSequence.RelatingProcess.value;
        this.tasks[relatingProcess]["IsPredecessorTo"].push(relSequence.expressID);
        this.tasks[related_process]["IsSucessorFrom"].push(relSequence.expressID);
      }
    }
  }

  async loadTaskOutputs(modelID) {
    let rels_assigns_to_product = await this.utils.byType(modelID, "IfcRelAssignsToProduct");
    for (let i = 0; i < rels_assigns_to_product.length; i++) {
      let relAssignsToProduct = rels_assigns_to_product[i];
      let relatedObject = await this.utils.byId(modelID, relAssignsToProduct.RelatedObjects[0].value);
      if (this.utils.isA(relatedObject, "IfcTask")) {
        let relatingProduct = await this.utils.byId(modelID, relAssignsToProduct.RelatingProduct.value);
        this.tasks[relatedObject.expressID]["Outputs"].push(relatingProduct.expressID);
      }
    }
  }

  async loadTaskNesting(modelID) {
    let rels_nests = await this.utils.byType(modelID, "IfcRelNests");
    for (let i = 0; i < rels_nests.length; i++) {
      let relNests = rels_nests[i];
      let relating_object = await this.utils.byId(modelID, relNests.RelatingObject.value);
      if (this.utils.isA(relating_object, "IfcTask")) {
        let relatedObjects = relNests.RelatedObjects;
        for (var object_index = 0; object_index < relatedObjects.length; object_index++) {
          this.tasks[relating_object.expressID]["IsNestedBy"].push(relatedObjects[object_index].value);
          this.tasks[relatedObjects[object_index].value]["Nests"].push(relating_object.expressID);
        }
      }
    }
  }

  async loadTaskOperations(modelID) {
    let relsAssignsToProcess = await this.utils.byType(modelID, "IfcRelAssignsToProcess");
    for (let i = 0; i < relsAssignsToProcess.length; i++) {
      let relAssignToProcess = relsAssignsToProcess[i];
      let relatingProcess = await this.utils.byId(modelID, relAssignToProcess.RelatingProcess.value);
      if (this.utils.isA(relatingProcess, "IfcTask")) {
        let relatedObjects = relAssignToProcess.RelatedObjects;
        for (var object_index = 0; object_index < relatedObjects.length; object_index++) {
          this.tasks[relatingProcess.expressID]["OperatesOn"].push(relatedObjects[object_index].value);
        }
      }
    }
  }

  async loadAssignementsWorkCalendar(modelID) {
    let relsAssignsToControl = await this.utils.byType(modelID, "IfcRelAssignsToControl");
    for (let i = 0; i < relsAssignsToControl.length; i++) {
      let relAssignsToControl = relsAssignsToControl[i];
      let relatingControl = await this.utils.byId(modelID, relAssignsToControl.RelatingControl.value);
      if (this.utils.isA(relatingControl, "IfcWorkCalendar")) {
        let relatedObjects = relAssignsToControl.RelatedObjects;
        for (var object_index = 0; object_index < relatedObjects.length; object_index++) {
          this.tasks[relatedObjects[object_index].value]["HasAssignmentsWorkCalendars"].push(relatingControl.expressID);
        }
      }
    }
  }

  async loadWorkCalendars(modelID) {
    let workCalendars = await this.utils.byType(modelID, "IfcWorkCalendar");
    for (let i = 0; i < workCalendars.length; i++) {
      let workCalendar = workCalendars[i];
      let workCalenderData = {
        "Id": workCalendar.expressID,
        "Name": ((workCalendar.Name) ? workCalendar.Name.value : ""),
        "Description": ((workCalendar.Description) ? workCalendar.Description.value : ""),
        "WorkingTimes": ((workCalendar.WorkingTimes) ? workCalendar.WorkingTimes : []),
        "ExceptionTimes": ((workCalendar.ExceptionTimes) ? workCalendar.ExceptionTimes : []),
      };
      this.workCalendars[workCalendar.expressID] = workCalenderData;
    }
  }

  async loadWorkTimes(modelID) {
    let workTimes = await this.utils.byType(modelID, "IfcWorkTime");
    for (let i = 0; i < workTimes.length; i++) {
      let workTime = workTimes[i];
      let workTimeData = {
        "Name": ((workTime.Name) ? workTime.Name.value : ""),
        "RecurrencePattern": ((workTime.RecurrencePattern) ? await this.utils.byId(modelID, workTime.RecurrencePattern.value) : ""),
        "Start": ((workTime.Start) ? new Date(workTime.Start.value) : ""),
        "Finish": ((workTime.Finish) ? new Date(workTime.Finish.value) : ""),
      };
      this.workTimes[workTime.expressID] = workTimeData;
    }
  }

  async loadTimePeriods(modelID) {
    let timePeriods = await this.utils.byType(modelID, "IfcTimePeriod");
    for (let i = 0; i < timePeriods.length; i++) {
      let timePeriod = timePeriods[i];
      let workTimeData = {
        "StartTime": ((timePeriod.StartTime) ? new Date(timePeriod.StartTime.value) : ""),
        "EndTime": ((timePeriod.EndTime) ? new Date(timePeriod.EndTime.value) : ""),
      };
      this.timePeriods[timePeriod.expressID] = workTimeData;
    }
  }

}

class GeometryUtils {

  static merge(geometriesByMaterial, splitByBlocks = false) {
    const geometriesByMat = [];
    const sizes = [];
    for (const geometries of geometriesByMaterial) {
      const merged = this.mergeGeomsOfSameMaterial(geometries, splitByBlocks);
      geometriesByMat.push(merged);
      sizes.push(merged.index.count);
    }
    const geometry = mergeBufferGeometries(geometriesByMat);
    this.setupMaterialGroups(sizes, geometry);
    this.cleanUp(geometriesByMat);
    return geometry;
  }

  // When Three.js exports to glTF, it generates one separate mesh per material. All meshes
  // share the same BufferAttributes and have different indices

  static async mergeGltfMeshes(meshes) {
    const geometry = new BufferGeometry();
    const attributes = meshes[0].geometry.attributes;
    this.getMeshesAttributes(geometry, attributes);
    this.getMeshesIndices(geometry, meshes);
    return geometry;
  }

  static getMeshesAttributes(geometry, attributes) {
    // Three.js GLTFExporter exports custom BufferAttributes as underscore lowercase
    // eslint-disable-next-line no-underscore-dangle
    geometry.setAttribute('blockID', attributes._blockid);
    geometry.setAttribute('position', attributes.position);
    geometry.setAttribute('normal', attributes.normal);
    geometry.groups = [];
  }

  static getMeshesIndices(geometry, meshes) {
    const counter = {
      index: 0,
      material: 0
    };
    const indices = [];
    for (const mesh of meshes) {
      const index = mesh.geometry.index;
      this.getIndicesOfMesh(index, indices);
      this.getMeshGroup(geometry, counter, index);
      this.cleanUpMesh(mesh);
    }
    geometry.setIndex(indices);
  }

  static getMeshGroup(geometry, counter, index) {
    geometry.groups.push({
      start: counter.index,
      count: index.count,
      materialIndex: counter.material++
    });
    counter.index += index.count;
  }

  static cleanUpMesh(mesh) {
    mesh.geometry.setIndex([]);
    mesh.geometry.attributes = {};
    mesh.geometry.dispose();
  }

  static getIndicesOfMesh(index, indices) {
    for (const number of index.array) {
      indices.push(number);
    }
  }

  static cleanUp(geometries) {
    geometries.forEach((geometry) => geometry.dispose());
    geometries.length = 0;
  }

  static setupMaterialGroups(sizes, geometry) {
    let vertexCounter = 0;
    let counter = 0;
    for (const size of sizes) {
      const group = {
        start: vertexCounter,
        count: size,
        materialIndex: counter++
      };
      geometry.groups.push(group);
      vertexCounter += size;
    }
  }

  static mergeGeomsOfSameMaterial(geometries, splitByBlocks) {
    this.checkAllGeometriesAreIndexed(geometries);
    if (splitByBlocks) {
      this.splitByBlocks(geometries);
    }
    const merged = mergeBufferGeometries(geometries);
    this.cleanUp(geometries);
    return merged;
  }

  static splitByBlocks(geometries) {
    let i = 0;
    for (const geometry of geometries) {
      const size = geometry.attributes.position.count;
      const array = new Uint8Array(size).fill(i++);
      geometry.setAttribute('blockID', new BufferAttribute$1(array, 1));
    }
  }

  static checkAllGeometriesAreIndexed(geometries) {
    for (const geometry of geometries) {
      if (!geometry.index) {
        throw new Error('All geometries must be indexed!');
      }
    }
  }

}

class Vector4 {

  constructor(x = 0, y = 0, z = 0, w = 1) {

    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;

  }

  get width() {

    return this.z;

  }

  set width(value) {

    this.z = value;

  }

  get height() {

    return this.w;

  }

  set height(value) {

    this.w = value;

  }

  set(x, y, z, w) {

    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;

    return this;

  }

  setScalar(scalar) {

    this.x = scalar;
    this.y = scalar;
    this.z = scalar;
    this.w = scalar;

    return this;

  }

  setX(x) {

    this.x = x;

    return this;

  }

  setY(y) {

    this.y = y;

    return this;

  }

  setZ(z) {

    this.z = z;

    return this;

  }

  setW(w) {

    this.w = w;

    return this;

  }

  setComponent(index, value) {

    switch (index) {

      case 0:
        this.x = value;
        break;
      case 1:
        this.y = value;
        break;
      case 2:
        this.z = value;
        break;
      case 3:
        this.w = value;
        break;
      default:
        throw new Error('index is out of range: ' + index);

    }

    return this;

  }

  getComponent(index) {

    switch (index) {

      case 0:
        return this.x;
      case 1:
        return this.y;
      case 2:
        return this.z;
      case 3:
        return this.w;
      default:
        throw new Error('index is out of range: ' + index);

    }

  }

  clone() {

    return new this.constructor(this.x, this.y, this.z, this.w);

  }

  copy(v) {

    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    this.w = (v.w !== undefined) ? v.w : 1;

    return this;

  }

  add(v, w) {

    if (w !== undefined) {

      console.warn('THREE.Vector4: .add() now only accepts one argument. Use .addVectors( a, b ) instead.');
      return this.addVectors(v, w);

    }

    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    this.w += v.w;

    return this;

  }

  addScalar(s) {

    this.x += s;
    this.y += s;
    this.z += s;
    this.w += s;

    return this;

  }

  addVectors(a, b) {

    this.x = a.x + b.x;
    this.y = a.y + b.y;
    this.z = a.z + b.z;
    this.w = a.w + b.w;

    return this;

  }

  addScaledVector(v, s) {

    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    this.w += v.w * s;

    return this;

  }

  sub(v, w) {

    if (w !== undefined) {

      console.warn('THREE.Vector4: .sub() now only accepts one argument. Use .subVectors( a, b ) instead.');
      return this.subVectors(v, w);

    }

    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    this.w -= v.w;

    return this;

  }

  subScalar(s) {

    this.x -= s;
    this.y -= s;
    this.z -= s;
    this.w -= s;

    return this;

  }

  subVectors(a, b) {

    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    this.w = a.w - b.w;

    return this;

  }

  multiply(v) {

    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    this.w *= v.w;

    return this;

  }

  multiplyScalar(scalar) {

    this.x *= scalar;
    this.y *= scalar;
    this.z *= scalar;
    this.w *= scalar;

    return this;

  }

  applyMatrix4(m) {

    const x = this.x,
      y = this.y,
      z = this.z,
      w = this.w;
    const e = m.elements;

    this.x = e[0] * x + e[4] * y + e[8] * z + e[12] * w;
    this.y = e[1] * x + e[5] * y + e[9] * z + e[13] * w;
    this.z = e[2] * x + e[6] * y + e[10] * z + e[14] * w;
    this.w = e[3] * x + e[7] * y + e[11] * z + e[15] * w;

    return this;

  }

  divideScalar(scalar) {

    return this.multiplyScalar(1 / scalar);

  }

  setAxisAngleFromQuaternion(q) {

    // http://www.euclideanspace.com/maths/geometry/rotations/conversions/quaternionToAngle/index.htm

    // q is assumed to be normalized

    this.w = 2 * Math.acos(q.w);

    const s = Math.sqrt(1 - q.w * q.w);

    if (s < 0.0001) {

      this.x = 1;
      this.y = 0;
      this.z = 0;

    } else {

      this.x = q.x / s;
      this.y = q.y / s;
      this.z = q.z / s;

    }

    return this;

  }

  setAxisAngleFromRotationMatrix(m) {

    // http://www.euclideanspace.com/maths/geometry/rotations/conversions/matrixToAngle/index.htm

    // assumes the upper 3x3 of m is a pure rotation matrix (i.e, unscaled)

    let angle,
      x,
      y,
      z; // variables for result
    const epsilon = 0.01, // margin to allow for rounding errors
      epsilon2 = 0.1, // margin to distinguish between 0 and 180 degrees

      te = m.elements,

      m11 = te[0],
      m12 = te[4],
      m13 = te[8],
      m21 = te[1],
      m22 = te[5],
      m23 = te[9],
      m31 = te[2],
      m32 = te[6],
      m33 = te[10];

    if ((Math.abs(m12 - m21) < epsilon) &&
      (Math.abs(m13 - m31) < epsilon) &&
      (Math.abs(m23 - m32) < epsilon)) {

      // singularity found
      // first check for identity matrix which must have +1 for all terms
      // in leading diagonal and zero in other terms

      if ((Math.abs(m12 + m21) < epsilon2) &&
        (Math.abs(m13 + m31) < epsilon2) &&
        (Math.abs(m23 + m32) < epsilon2) &&
        (Math.abs(m11 + m22 + m33 - 3) < epsilon2)) {

        // this singularity is identity matrix so angle = 0

        this.set(1, 0, 0, 0);

        return this; // zero angle, arbitrary axis

      }

      // otherwise this singularity is angle = 180

      angle = Math.PI;

      const xx = (m11 + 1) / 2;
      const yy = (m22 + 1) / 2;
      const zz = (m33 + 1) / 2;
      const xy = (m12 + m21) / 4;
      const xz = (m13 + m31) / 4;
      const yz = (m23 + m32) / 4;

      if ((xx > yy) && (xx > zz)) {

        // m11 is the largest diagonal term

        if (xx < epsilon) {

          x = 0;
          y = 0.707106781;
          z = 0.707106781;

        } else {

          x = Math.sqrt(xx);
          y = xy / x;
          z = xz / x;

        }

      } else if (yy > zz) {

        // m22 is the largest diagonal term

        if (yy < epsilon) {

          x = 0.707106781;
          y = 0;
          z = 0.707106781;

        } else {

          y = Math.sqrt(yy);
          x = xy / y;
          z = yz / y;

        }

      } else {

        // m33 is the largest diagonal term so base result on this

        if (zz < epsilon) {

          x = 0.707106781;
          y = 0.707106781;
          z = 0;

        } else {

          z = Math.sqrt(zz);
          x = xz / z;
          y = yz / z;

        }

      }

      this.set(x, y, z, angle);

      return this; // return 180 deg rotation

    }

    // as we have reached here there are no singularities so we can handle normally

    let s = Math.sqrt((m32 - m23) * (m32 - m23) +
      (m13 - m31) * (m13 - m31) +
      (m21 - m12) * (m21 - m12)); // used to normalize

    if (Math.abs(s) < 0.001)
      s = 1;

    // prevent divide by zero, should not happen if matrix is orthogonal and should be
      // caught by singularity test above, but I've left it in just in case

    this.x = (m32 - m23) / s;
    this.y = (m13 - m31) / s;
    this.z = (m21 - m12) / s;
    this.w = Math.acos((m11 + m22 + m33 - 1) / 2);

    return this;

  }

  min(v) {

    this.x = Math.min(this.x, v.x);
    this.y = Math.min(this.y, v.y);
    this.z = Math.min(this.z, v.z);
    this.w = Math.min(this.w, v.w);

    return this;

  }

  max(v) {

    this.x = Math.max(this.x, v.x);
    this.y = Math.max(this.y, v.y);
    this.z = Math.max(this.z, v.z);
    this.w = Math.max(this.w, v.w);

    return this;

  }

  clamp(min, max) {

    // assumes min < max, componentwise

    this.x = Math.max(min.x, Math.min(max.x, this.x));
    this.y = Math.max(min.y, Math.min(max.y, this.y));
    this.z = Math.max(min.z, Math.min(max.z, this.z));
    this.w = Math.max(min.w, Math.min(max.w, this.w));

    return this;

  }

  clampScalar(minVal, maxVal) {

    this.x = Math.max(minVal, Math.min(maxVal, this.x));
    this.y = Math.max(minVal, Math.min(maxVal, this.y));
    this.z = Math.max(minVal, Math.min(maxVal, this.z));
    this.w = Math.max(minVal, Math.min(maxVal, this.w));

    return this;

  }

  clampLength(min, max) {

    const length = this.length();

    return this.divideScalar(length || 1).multiplyScalar(Math.max(min, Math.min(max, length)));

  }

  floor() {

    this.x = Math.floor(this.x);
    this.y = Math.floor(this.y);
    this.z = Math.floor(this.z);
    this.w = Math.floor(this.w);

    return this;

  }

  ceil() {

    this.x = Math.ceil(this.x);
    this.y = Math.ceil(this.y);
    this.z = Math.ceil(this.z);
    this.w = Math.ceil(this.w);

    return this;

  }

  round() {

    this.x = Math.round(this.x);
    this.y = Math.round(this.y);
    this.z = Math.round(this.z);
    this.w = Math.round(this.w);

    return this;

  }

  roundToZero() {

    this.x = (this.x < 0) ? Math.ceil(this.x) : Math.floor(this.x);
    this.y = (this.y < 0) ? Math.ceil(this.y) : Math.floor(this.y);
    this.z = (this.z < 0) ? Math.ceil(this.z) : Math.floor(this.z);
    this.w = (this.w < 0) ? Math.ceil(this.w) : Math.floor(this.w);

    return this;

  }

  negate() {

    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    this.w = -this.w;

    return this;

  }

  dot(v) {

    return this.x * v.x + this.y * v.y + this.z * v.z + this.w * v.w;

  }

  lengthSq() {

    return this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w;

  }

  length() {

    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);

  }

  manhattanLength() {

    return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z) + Math.abs(this.w);

  }

  normalize() {

    return this.divideScalar(this.length() || 1);

  }

  setLength(length) {

    return this.normalize().multiplyScalar(length);

  }

  lerp(v, alpha) {

    this.x += (v.x - this.x) * alpha;
    this.y += (v.y - this.y) * alpha;
    this.z += (v.z - this.z) * alpha;
    this.w += (v.w - this.w) * alpha;

    return this;

  }

  lerpVectors(v1, v2, alpha) {

    this.x = v1.x + (v2.x - v1.x) * alpha;
    this.y = v1.y + (v2.y - v1.y) * alpha;
    this.z = v1.z + (v2.z - v1.z) * alpha;
    this.w = v1.w + (v2.w - v1.w) * alpha;

    return this;

  }

  equals(v) {

    return ((v.x === this.x) && (v.y === this.y) && (v.z === this.z) && (v.w === this.w));

  }

  fromArray(array, offset = 0) {

    this.x = array[offset];
    this.y = array[offset + 1];
    this.z = array[offset + 2];
    this.w = array[offset + 3];

    return this;

  }

  toArray(array = [], offset = 0) {

    array[offset] = this.x;
    array[offset + 1] = this.y;
    array[offset + 2] = this.z;
    array[offset + 3] = this.w;

    return array;

  }

  fromBufferAttribute(attribute, index, offset) {

    if (offset !== undefined) {

      console.warn('THREE.Vector4: offset has been removed from .fromBufferAttribute().');

    }

    this.x = attribute.getX(index);
    this.y = attribute.getY(index);
    this.z = attribute.getZ(index);
    this.w = attribute.getW(index);

    return this;

  }

  random() {

    this.x = Math.random();
    this.y = Math.random();
    this.z = Math.random();
    this.w = Math.random();

    return this;

  }

  * [ Symbol.iterator]() {

    yield this.x;
    yield this.y;
    yield this.z;
    yield this.w;

  }

}

Vector4.prototype.isVector4 = true;

for (let i = 0; i < 256; i++) {

  (i < 16 ? '0' : '') + ( i ).toString(16);

}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

// compute euclidian modulo of m % n
// https://en.wikipedia.org/wiki/Modulo_operation

function euclideanModulo(n, m) {
  return ((n % m) + m) % m;
}

// https://en.wikipedia.org/wiki/Linear_interpolation

function lerp(x, y, t) {
  return (1 - t) * x + t * y;
}

class Quaternion {

  constructor(x = 0, y = 0, z = 0, w = 1) {

    this._x = x;
    this._y = y;
    this._z = z;
    this._w = w;

  }

  static slerp(qa, qb, qm, t) {

    console.warn('THREE.Quaternion: Static .slerp() has been deprecated. Use qm.slerpQuaternions( qa, qb, t ) instead.');
    return qm.slerpQuaternions(qa, qb, t);

  }

  static slerpFlat(dst, dstOffset, src0, srcOffset0, src1, srcOffset1, t) {

    // fuzz-free, array-based Quaternion SLERP operation

    let x0 = src0[srcOffset0 + 0],
      y0 = src0[srcOffset0 + 1],
      z0 = src0[srcOffset0 + 2],
      w0 = src0[srcOffset0 + 3];

    const x1 = src1[srcOffset1 + 0],
      y1 = src1[srcOffset1 + 1],
      z1 = src1[srcOffset1 + 2],
      w1 = src1[srcOffset1 + 3];

    if (t === 0) {

      dst[dstOffset + 0] = x0;
      dst[dstOffset + 1] = y0;
      dst[dstOffset + 2] = z0;
      dst[dstOffset + 3] = w0;
      return;

    }

    if (t === 1) {

      dst[dstOffset + 0] = x1;
      dst[dstOffset + 1] = y1;
      dst[dstOffset + 2] = z1;
      dst[dstOffset + 3] = w1;
      return;

    }

    if (w0 !== w1 || x0 !== x1 || y0 !== y1 || z0 !== z1) {

      let s = 1 - t;
      const cos = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1,
        dir = (cos >= 0 ? 1 : -1),
        sqrSin = 1 - cos * cos;

      // Skip the Slerp for tiny steps to avoid numeric problems:
      if (sqrSin > Number.EPSILON) {

        const sin = Math.sqrt(sqrSin),
          len = Math.atan2(sin, cos * dir);

        s = Math.sin(s * len) / sin;
        t = Math.sin(t * len) / sin;

      }

      const tDir = t * dir;

      x0 = x0 * s + x1 * tDir;
      y0 = y0 * s + y1 * tDir;
      z0 = z0 * s + z1 * tDir;
      w0 = w0 * s + w1 * tDir;

      // Normalize in case we just did a lerp:
      if (s === 1 - t) {

        const f = 1 / Math.sqrt(x0 * x0 + y0 * y0 + z0 * z0 + w0 * w0);

        x0 *= f;
        y0 *= f;
        z0 *= f;
        w0 *= f;

      }

    }

    dst[dstOffset] = x0;
    dst[dstOffset + 1] = y0;
    dst[dstOffset + 2] = z0;
    dst[dstOffset + 3] = w0;

  }

  static multiplyQuaternionsFlat(dst, dstOffset, src0, srcOffset0, src1, srcOffset1) {

    const x0 = src0[srcOffset0];
    const y0 = src0[srcOffset0 + 1];
    const z0 = src0[srcOffset0 + 2];
    const w0 = src0[srcOffset0 + 3];

    const x1 = src1[srcOffset1];
    const y1 = src1[srcOffset1 + 1];
    const z1 = src1[srcOffset1 + 2];
    const w1 = src1[srcOffset1 + 3];

    dst[dstOffset] = x0 * w1 + w0 * x1 + y0 * z1 - z0 * y1;
    dst[dstOffset + 1] = y0 * w1 + w0 * y1 + z0 * x1 - x0 * z1;
    dst[dstOffset + 2] = z0 * w1 + w0 * z1 + x0 * y1 - y0 * x1;
    dst[dstOffset + 3] = w0 * w1 - x0 * x1 - y0 * y1 - z0 * z1;

    return dst;

  }

  get x() {

    return this._x;

  }

  set x(value) {

    this._x = value;
    this._onChangeCallback();

  }

  get y() {

    return this._y;

  }

  set y(value) {

    this._y = value;
    this._onChangeCallback();

  }

  get z() {

    return this._z;

  }

  set z(value) {

    this._z = value;
    this._onChangeCallback();

  }

  get w() {

    return this._w;

  }

  set w(value) {

    this._w = value;
    this._onChangeCallback();

  }

  set(x, y, z, w) {

    this._x = x;
    this._y = y;
    this._z = z;
    this._w = w;

    this._onChangeCallback();

    return this;

  }

  clone() {

    return new this.constructor(this._x, this._y, this._z, this._w);

  }

  copy(quaternion) {

    this._x = quaternion.x;
    this._y = quaternion.y;
    this._z = quaternion.z;
    this._w = quaternion.w;

    this._onChangeCallback();

    return this;

  }

  setFromEuler(euler, update) {

    if (!(euler && euler.isEuler)) {

      throw new Error('THREE.Quaternion: .setFromEuler() now expects an Euler rotation rather than a Vector3 and order.');

    }

    const x = euler._x,
      y = euler._y,
      z = euler._z,
      order = euler._order;

    // http://www.mathworks.com/matlabcentral/fileexchange/
      // 	20696-function-to-convert-between-dcm-euler-angles-quaternions-and-euler-vectors/
      //	content/SpinCalc.m

    const cos = Math.cos;
    const sin = Math.sin;

    const c1 = cos(x / 2);
    const c2 = cos(y / 2);
    const c3 = cos(z / 2);

    const s1 = sin(x / 2);
    const s2 = sin(y / 2);
    const s3 = sin(z / 2);

    switch (order) {

      case 'XYZ':
        this._x = s1 * c2 * c3 + c1 * s2 * s3;
        this._y = c1 * s2 * c3 - s1 * c2 * s3;
        this._z = c1 * c2 * s3 + s1 * s2 * c3;
        this._w = c1 * c2 * c3 - s1 * s2 * s3;
        break;

      case 'YXZ':
        this._x = s1 * c2 * c3 + c1 * s2 * s3;
        this._y = c1 * s2 * c3 - s1 * c2 * s3;
        this._z = c1 * c2 * s3 - s1 * s2 * c3;
        this._w = c1 * c2 * c3 + s1 * s2 * s3;
        break;

      case 'ZXY':
        this._x = s1 * c2 * c3 - c1 * s2 * s3;
        this._y = c1 * s2 * c3 + s1 * c2 * s3;
        this._z = c1 * c2 * s3 + s1 * s2 * c3;
        this._w = c1 * c2 * c3 - s1 * s2 * s3;
        break;

      case 'ZYX':
        this._x = s1 * c2 * c3 - c1 * s2 * s3;
        this._y = c1 * s2 * c3 + s1 * c2 * s3;
        this._z = c1 * c2 * s3 - s1 * s2 * c3;
        this._w = c1 * c2 * c3 + s1 * s2 * s3;
        break;

      case 'YZX':
        this._x = s1 * c2 * c3 + c1 * s2 * s3;
        this._y = c1 * s2 * c3 + s1 * c2 * s3;
        this._z = c1 * c2 * s3 - s1 * s2 * c3;
        this._w = c1 * c2 * c3 - s1 * s2 * s3;
        break;

      case 'XZY':
        this._x = s1 * c2 * c3 - c1 * s2 * s3;
        this._y = c1 * s2 * c3 - s1 * c2 * s3;
        this._z = c1 * c2 * s3 + s1 * s2 * c3;
        this._w = c1 * c2 * c3 + s1 * s2 * s3;
        break;

      default:
        console.warn('THREE.Quaternion: .setFromEuler() encountered an unknown order: ' + order);

    }

    if (update !== false) this._onChangeCallback();

    return this;

  }

  setFromAxisAngle(axis, angle) {

    // http://www.euclideanspace.com/maths/geometry/rotations/conversions/angleToQuaternion/index.htm

    // assumes axis is normalized

    const halfAngle = angle / 2,
      s = Math.sin(halfAngle);

    this._x = axis.x * s;
    this._y = axis.y * s;
    this._z = axis.z * s;
    this._w = Math.cos(halfAngle);

    this._onChangeCallback();

    return this;

  }

  setFromRotationMatrix(m) {

    // http://www.euclideanspace.com/maths/geometry/rotations/conversions/matrixToQuaternion/index.htm

    // assumes the upper 3x3 of m is a pure rotation matrix (i.e, unscaled)

    const te = m.elements,

      m11 = te[0],
      m12 = te[4],
      m13 = te[8],
      m21 = te[1],
      m22 = te[5],
      m23 = te[9],
      m31 = te[2],
      m32 = te[6],
      m33 = te[10],

      trace = m11 + m22 + m33;

    if (trace > 0) {

      const s = 0.5 / Math.sqrt(trace + 1.0);

      this._w = 0.25 / s;
      this._x = (m32 - m23) * s;
      this._y = (m13 - m31) * s;
      this._z = (m21 - m12) * s;

    } else if (m11 > m22 && m11 > m33) {

      const s = 2.0 * Math.sqrt(1.0 + m11 - m22 - m33);

      this._w = (m32 - m23) / s;
      this._x = 0.25 * s;
      this._y = (m12 + m21) / s;
      this._z = (m13 + m31) / s;

    } else if (m22 > m33) {

      const s = 2.0 * Math.sqrt(1.0 + m22 - m11 - m33);

      this._w = (m13 - m31) / s;
      this._x = (m12 + m21) / s;
      this._y = 0.25 * s;
      this._z = (m23 + m32) / s;

    } else {

      const s = 2.0 * Math.sqrt(1.0 + m33 - m11 - m22);

      this._w = (m21 - m12) / s;
      this._x = (m13 + m31) / s;
      this._y = (m23 + m32) / s;
      this._z = 0.25 * s;

    }

    this._onChangeCallback();

    return this;

  }

  setFromUnitVectors(vFrom, vTo) {

    // assumes direction vectors vFrom and vTo are normalized

    let r = vFrom.dot(vTo) + 1;

    if (r < Number.EPSILON) {

      // vFrom and vTo point in opposite directions

      r = 0;

      if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) {

        this._x = -vFrom.y;
        this._y = vFrom.x;
        this._z = 0;
        this._w = r;

      } else {

        this._x = 0;
        this._y = -vFrom.z;
        this._z = vFrom.y;
        this._w = r;

      }

    } else {

      // crossVectors( vFrom, vTo ); // inlined to avoid cyclic dependency on Vector3

      this._x = vFrom.y * vTo.z - vFrom.z * vTo.y;
      this._y = vFrom.z * vTo.x - vFrom.x * vTo.z;
      this._z = vFrom.x * vTo.y - vFrom.y * vTo.x;
      this._w = r;

    }

    return this.normalize();

  }

  angleTo(q) {

    return 2 * Math.acos(Math.abs(clamp(this.dot(q), -1, 1)));

  }

  rotateTowards(q, step) {

    const angle = this.angleTo(q);

    if (angle === 0) return this;

    const t = Math.min(1, step / angle);

    this.slerp(q, t);

    return this;

  }

  identity() {

    return this.set(0, 0, 0, 1);

  }

  invert() {

    // quaternion is assumed to have unit length

    return this.conjugate();

  }

  conjugate() {

    this._x *= -1;
    this._y *= -1;
    this._z *= -1;

    this._onChangeCallback();

    return this;

  }

  dot(v) {

    return this._x * v._x + this._y * v._y + this._z * v._z + this._w * v._w;

  }

  lengthSq() {

    return this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w;

  }

  length() {

    return Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w);

  }

  normalize() {

    let l = this.length();

    if (l === 0) {

      this._x = 0;
      this._y = 0;
      this._z = 0;
      this._w = 1;

    } else {

      l = 1 / l;

      this._x = this._x * l;
      this._y = this._y * l;
      this._z = this._z * l;
      this._w = this._w * l;

    }

    this._onChangeCallback();

    return this;

  }

  multiply(q, p) {

    if (p !== undefined) {

      console.warn('THREE.Quaternion: .multiply() now only accepts one argument. Use .multiplyQuaternions( a, b ) instead.');
      return this.multiplyQuaternions(q, p);

    }

    return this.multiplyQuaternions(this, q);

  }

  premultiply(q) {

    return this.multiplyQuaternions(q, this);

  }

  multiplyQuaternions(a, b) {

    // from http://www.euclideanspace.com/maths/algebra/realNormedAlgebra/quaternions/code/index.htm

    const qax = a._x,
      qay = a._y,
      qaz = a._z,
      qaw = a._w;
    const qbx = b._x,
      qby = b._y,
      qbz = b._z,
      qbw = b._w;

    this._x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
    this._y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
    this._z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
    this._w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;

    this._onChangeCallback();

    return this;

  }

  slerp(qb, t) {

    if (t === 0) return this;
    if (t === 1) return this.copy(qb);

    const x = this._x,
      y = this._y,
      z = this._z,
      w = this._w;

    // http://www.euclideanspace.com/maths/algebra/realNormedAlgebra/quaternions/slerp/

    let cosHalfTheta = w * qb._w + x * qb._x + y * qb._y + z * qb._z;

    if (cosHalfTheta < 0) {

      this._w = -qb._w;
      this._x = -qb._x;
      this._y = -qb._y;
      this._z = -qb._z;

      cosHalfTheta = -cosHalfTheta;

    } else {

      this.copy(qb);

    }

    if (cosHalfTheta >= 1.0) {

      this._w = w;
      this._x = x;
      this._y = y;
      this._z = z;

      return this;

    }

    const sqrSinHalfTheta = 1.0 - cosHalfTheta * cosHalfTheta;

    if (sqrSinHalfTheta <= Number.EPSILON) {

      const s = 1 - t;
      this._w = s * w + t * this._w;
      this._x = s * x + t * this._x;
      this._y = s * y + t * this._y;
      this._z = s * z + t * this._z;

      this.normalize();
      this._onChangeCallback();

      return this;

    }

    const sinHalfTheta = Math.sqrt(sqrSinHalfTheta);
    const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);
    const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta,
      ratioB = Math.sin(t * halfTheta) / sinHalfTheta;

    this._w = (w * ratioA + this._w * ratioB);
    this._x = (x * ratioA + this._x * ratioB);
    this._y = (y * ratioA + this._y * ratioB);
    this._z = (z * ratioA + this._z * ratioB);

    this._onChangeCallback();

    return this;

  }

  slerpQuaternions(qa, qb, t) {

    this.copy(qa).slerp(qb, t);

  }

  random() {

    // Derived from http://planning.cs.uiuc.edu/node198.html
    // Note, this source uses w, x, y, z ordering,
    // so we swap the order below.

    const u1 = Math.random();
    const sqrt1u1 = Math.sqrt(1 - u1);
    const sqrtu1 = Math.sqrt(u1);

    const u2 = 2 * Math.PI * Math.random();

    const u3 = 2 * Math.PI * Math.random();

    return this.set(
      sqrt1u1 * Math.cos(u2),
      sqrtu1 * Math.sin(u3),
      sqrtu1 * Math.cos(u3),
      sqrt1u1 * Math.sin(u2),
    );

  }

  equals(quaternion) {

    return (quaternion._x === this._x) && (quaternion._y === this._y) && (quaternion._z === this._z) && (quaternion._w === this._w);

  }

  fromArray(array, offset = 0) {

    this._x = array[offset];
    this._y = array[offset + 1];
    this._z = array[offset + 2];
    this._w = array[offset + 3];

    this._onChangeCallback();

    return this;

  }

  toArray(array = [], offset = 0) {

    array[offset] = this._x;
    array[offset + 1] = this._y;
    array[offset + 2] = this._z;
    array[offset + 3] = this._w;

    return array;

  }

  fromBufferAttribute(attribute, index) {

    this._x = attribute.getX(index);
    this._y = attribute.getY(index);
    this._z = attribute.getZ(index);
    this._w = attribute.getW(index);

    return this;

  }

  _onChange(callback) {

    this._onChangeCallback = callback;

    return this;

  }

  _onChangeCallback() {}

}

Quaternion.prototype.isQuaternion = true;

class Vector3 {

  constructor(x = 0, y = 0, z = 0) {

    this.x = x;
    this.y = y;
    this.z = z;

  }

  set(x, y, z) {

    if (z === undefined)
      z = this.z; // sprite.scale.set(x,y)

    this.x = x;
    this.y = y;
    this.z = z;

    return this;

  }

  setScalar(scalar) {

    this.x = scalar;
    this.y = scalar;
    this.z = scalar;

    return this;

  }

  setX(x) {

    this.x = x;

    return this;

  }

  setY(y) {

    this.y = y;

    return this;

  }

  setZ(z) {

    this.z = z;

    return this;

  }

  setComponent(index, value) {

    switch (index) {

      case 0:
        this.x = value;
        break;
      case 1:
        this.y = value;
        break;
      case 2:
        this.z = value;
        break;
      default:
        throw new Error('index is out of range: ' + index);

    }

    return this;

  }

  getComponent(index) {

    switch (index) {

      case 0:
        return this.x;
      case 1:
        return this.y;
      case 2:
        return this.z;
      default:
        throw new Error('index is out of range: ' + index);

    }

  }

  clone() {

    return new this.constructor(this.x, this.y, this.z);

  }

  copy(v) {

    this.x = v.x;
    this.y = v.y;
    this.z = v.z;

    return this;

  }

  add(v, w) {

    if (w !== undefined) {

      console.warn('THREE.Vector3: .add() now only accepts one argument. Use .addVectors( a, b ) instead.');
      return this.addVectors(v, w);

    }

    this.x += v.x;
    this.y += v.y;
    this.z += v.z;

    return this;

  }

  addScalar(s) {

    this.x += s;
    this.y += s;
    this.z += s;

    return this;

  }

  addVectors(a, b) {

    this.x = a.x + b.x;
    this.y = a.y + b.y;
    this.z = a.z + b.z;

    return this;

  }

  addScaledVector(v, s) {

    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;

    return this;

  }

  sub(v, w) {

    if (w !== undefined) {

      console.warn('THREE.Vector3: .sub() now only accepts one argument. Use .subVectors( a, b ) instead.');
      return this.subVectors(v, w);

    }

    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;

    return this;

  }

  subScalar(s) {

    this.x -= s;
    this.y -= s;
    this.z -= s;

    return this;

  }

  subVectors(a, b) {

    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;

    return this;

  }

  multiply(v, w) {

    if (w !== undefined) {

      console.warn('THREE.Vector3: .multiply() now only accepts one argument. Use .multiplyVectors( a, b ) instead.');
      return this.multiplyVectors(v, w);

    }

    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;

    return this;

  }

  multiplyScalar(scalar) {

    this.x *= scalar;
    this.y *= scalar;
    this.z *= scalar;

    return this;

  }

  multiplyVectors(a, b) {

    this.x = a.x * b.x;
    this.y = a.y * b.y;
    this.z = a.z * b.z;

    return this;

  }

  applyEuler(euler) {

    if (!(euler && euler.isEuler)) {

      console.error('THREE.Vector3: .applyEuler() now expects an Euler rotation rather than a Vector3 and order.');

    }

    return this.applyQuaternion(_quaternion.setFromEuler(euler));

  }

  applyAxisAngle(axis, angle) {

    return this.applyQuaternion(_quaternion.setFromAxisAngle(axis, angle));

  }

  applyMatrix3(m) {

    const x = this.x,
      y = this.y,
      z = this.z;
    const e = m.elements;

    this.x = e[0] * x + e[3] * y + e[6] * z;
    this.y = e[1] * x + e[4] * y + e[7] * z;
    this.z = e[2] * x + e[5] * y + e[8] * z;

    return this;

  }

  applyNormalMatrix(m) {

    return this.applyMatrix3(m).normalize();

  }

  applyMatrix4(m) {

    const x = this.x,
      y = this.y,
      z = this.z;
    const e = m.elements;

    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);

    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;

    return this;

  }

  applyQuaternion(q) {

    const x = this.x,
      y = this.y,
      z = this.z;
    const qx = q.x,
      qy = q.y,
      qz = q.z,
      qw = q.w;

    // calculate quat * vector

    const ix = qw * x + qy * z - qz * y;
    const iy = qw * y + qz * x - qx * z;
    const iz = qw * z + qx * y - qy * x;
    const iw = -qx * x - qy * y - qz * z;

    // calculate result * inverse quat

    this.x = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    this.y = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    this.z = iz * qw + iw * -qz + ix * -qy - iy * -qx;

    return this;

  }

  project(camera) {

    return this.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);

  }

  unproject(camera) {

    return this.applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld);

  }

  transformDirection(m) {

    // input: THREE.Matrix4 affine matrix
    // vector interpreted as a direction

    const x = this.x,
      y = this.y,
      z = this.z;
    const e = m.elements;

    this.x = e[0] * x + e[4] * y + e[8] * z;
    this.y = e[1] * x + e[5] * y + e[9] * z;
    this.z = e[2] * x + e[6] * y + e[10] * z;

    return this.normalize();

  }

  divide(v) {

    this.x /= v.x;
    this.y /= v.y;
    this.z /= v.z;

    return this;

  }

  divideScalar(scalar) {

    return this.multiplyScalar(1 / scalar);

  }

  min(v) {

    this.x = Math.min(this.x, v.x);
    this.y = Math.min(this.y, v.y);
    this.z = Math.min(this.z, v.z);

    return this;

  }

  max(v) {

    this.x = Math.max(this.x, v.x);
    this.y = Math.max(this.y, v.y);
    this.z = Math.max(this.z, v.z);

    return this;

  }

  clamp(min, max) {

    // assumes min < max, componentwise

    this.x = Math.max(min.x, Math.min(max.x, this.x));
    this.y = Math.max(min.y, Math.min(max.y, this.y));
    this.z = Math.max(min.z, Math.min(max.z, this.z));

    return this;

  }

  clampScalar(minVal, maxVal) {

    this.x = Math.max(minVal, Math.min(maxVal, this.x));
    this.y = Math.max(minVal, Math.min(maxVal, this.y));
    this.z = Math.max(minVal, Math.min(maxVal, this.z));

    return this;

  }

  clampLength(min, max) {

    const length = this.length();

    return this.divideScalar(length || 1).multiplyScalar(Math.max(min, Math.min(max, length)));

  }

  floor() {

    this.x = Math.floor(this.x);
    this.y = Math.floor(this.y);
    this.z = Math.floor(this.z);

    return this;

  }

  ceil() {

    this.x = Math.ceil(this.x);
    this.y = Math.ceil(this.y);
    this.z = Math.ceil(this.z);

    return this;

  }

  round() {

    this.x = Math.round(this.x);
    this.y = Math.round(this.y);
    this.z = Math.round(this.z);

    return this;

  }

  roundToZero() {

    this.x = (this.x < 0) ? Math.ceil(this.x) : Math.floor(this.x);
    this.y = (this.y < 0) ? Math.ceil(this.y) : Math.floor(this.y);
    this.z = (this.z < 0) ? Math.ceil(this.z) : Math.floor(this.z);

    return this;

  }

  negate() {

    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;

    return this;

  }

  dot(v) {

    return this.x * v.x + this.y * v.y + this.z * v.z;

  }

  // TODO lengthSquared?

  lengthSq() {

    return this.x * this.x + this.y * this.y + this.z * this.z;

  }

  length() {

    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);

  }

  manhattanLength() {

    return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z);

  }

  normalize() {

    return this.divideScalar(this.length() || 1);

  }

  setLength(length) {

    return this.normalize().multiplyScalar(length);

  }

  lerp(v, alpha) {

    this.x += (v.x - this.x) * alpha;
    this.y += (v.y - this.y) * alpha;
    this.z += (v.z - this.z) * alpha;

    return this;

  }

  lerpVectors(v1, v2, alpha) {

    this.x = v1.x + (v2.x - v1.x) * alpha;
    this.y = v1.y + (v2.y - v1.y) * alpha;
    this.z = v1.z + (v2.z - v1.z) * alpha;

    return this;

  }

  cross(v, w) {

    if (w !== undefined) {

      console.warn('THREE.Vector3: .cross() now only accepts one argument. Use .crossVectors( a, b ) instead.');
      return this.crossVectors(v, w);

    }

    return this.crossVectors(this, v);

  }

  crossVectors(a, b) {

    const ax = a.x,
      ay = a.y,
      az = a.z;
    const bx = b.x,
      by = b.y,
      bz = b.z;

    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;

    return this;

  }

  projectOnVector(v) {

    const denominator = v.lengthSq();

    if (denominator === 0) return this.set(0, 0, 0);

    const scalar = v.dot(this) / denominator;

    return this.copy(v).multiplyScalar(scalar);

  }

  projectOnPlane(planeNormal) {

    _vector$1.copy(this).projectOnVector(planeNormal);

    return this.sub(_vector$1);

  }

  reflect(normal) {

    // reflect incident vector off plane orthogonal to normal
    // normal is assumed to have unit length

    return this.sub(_vector$1.copy(normal).multiplyScalar(2 * this.dot(normal)));

  }

  angleTo(v) {

    const denominator = Math.sqrt(this.lengthSq() * v.lengthSq());

    if (denominator === 0) return Math.PI / 2;

    const theta = this.dot(v) / denominator;

    // clamp, to handle numerical problems

    return Math.acos(clamp(theta, -1, 1));

  }

  distanceTo(v) {

    return Math.sqrt(this.distanceToSquared(v));

  }

  distanceToSquared(v) {

    const dx = this.x - v.x,
      dy = this.y - v.y,
      dz = this.z - v.z;

    return dx * dx + dy * dy + dz * dz;

  }

  manhattanDistanceTo(v) {

    return Math.abs(this.x - v.x) + Math.abs(this.y - v.y) + Math.abs(this.z - v.z);

  }

  setFromSpherical(s) {

    return this.setFromSphericalCoords(s.radius, s.phi, s.theta);

  }

  setFromSphericalCoords(radius, phi, theta) {

    const sinPhiRadius = Math.sin(phi) * radius;

    this.x = sinPhiRadius * Math.sin(theta);
    this.y = Math.cos(phi) * radius;
    this.z = sinPhiRadius * Math.cos(theta);

    return this;

  }

  setFromCylindrical(c) {

    return this.setFromCylindricalCoords(c.radius, c.theta, c.y);

  }

  setFromCylindricalCoords(radius, theta, y) {

    this.x = radius * Math.sin(theta);
    this.y = y;
    this.z = radius * Math.cos(theta);

    return this;

  }

  setFromMatrixPosition(m) {

    const e = m.elements;

    this.x = e[12];
    this.y = e[13];
    this.z = e[14];

    return this;

  }

  setFromMatrixScale(m) {

    const sx = this.setFromMatrixColumn(m, 0).length();
    const sy = this.setFromMatrixColumn(m, 1).length();
    const sz = this.setFromMatrixColumn(m, 2).length();

    this.x = sx;
    this.y = sy;
    this.z = sz;

    return this;

  }

  setFromMatrixColumn(m, index) {

    return this.fromArray(m.elements, index * 4);

  }

  setFromMatrix3Column(m, index) {

    return this.fromArray(m.elements, index * 3);

  }

  equals(v) {

    return ((v.x === this.x) && (v.y === this.y) && (v.z === this.z));

  }

  fromArray(array, offset = 0) {

    this.x = array[offset];
    this.y = array[offset + 1];
    this.z = array[offset + 2];

    return this;

  }

  toArray(array = [], offset = 0) {

    array[offset] = this.x;
    array[offset + 1] = this.y;
    array[offset + 2] = this.z;

    return array;

  }

  fromBufferAttribute(attribute, index, offset) {

    if (offset !== undefined) {

      console.warn('THREE.Vector3: offset has been removed from .fromBufferAttribute().');

    }

    this.x = attribute.getX(index);
    this.y = attribute.getY(index);
    this.z = attribute.getZ(index);

    return this;

  }

  random() {

    this.x = Math.random();
    this.y = Math.random();
    this.z = Math.random();

    return this;

  }

  randomDirection() {

    // Derived from https://mathworld.wolfram.com/SpherePointPicking.html

    const u = (Math.random() - 0.5) * 2;
    const t = Math.random() * Math.PI * 2;
    const f = Math.sqrt(1 - u ** 2);

    this.x = f * Math.cos(t);
    this.y = f * Math.sin(t);
    this.z = u;

    return this;

  }

  * [ Symbol.iterator]() {

    yield this.x;
    yield this.y;
    yield this.z;

  }

}

Vector3.prototype.isVector3 = true;

const _vector$1 = /*@__PURE__*/ new Vector3();
const _quaternion = /*@__PURE__*/ new Quaternion();

class Vector2 {

  constructor(x = 0, y = 0) {

    this.x = x;
    this.y = y;

  }

  get width() {

    return this.x;

  }

  set width(value) {

    this.x = value;

  }

  get height() {

    return this.y;

  }

  set height(value) {

    this.y = value;

  }

  set(x, y) {

    this.x = x;
    this.y = y;

    return this;

  }

  setScalar(scalar) {

    this.x = scalar;
    this.y = scalar;

    return this;

  }

  setX(x) {

    this.x = x;

    return this;

  }

  setY(y) {

    this.y = y;

    return this;

  }

  setComponent(index, value) {

    switch (index) {

      case 0:
        this.x = value;
        break;
      case 1:
        this.y = value;
        break;
      default:
        throw new Error('index is out of range: ' + index);

    }

    return this;

  }

  getComponent(index) {

    switch (index) {

      case 0:
        return this.x;
      case 1:
        return this.y;
      default:
        throw new Error('index is out of range: ' + index);

    }

  }

  clone() {

    return new this.constructor(this.x, this.y);

  }

  copy(v) {

    this.x = v.x;
    this.y = v.y;

    return this;

  }

  add(v, w) {

    if (w !== undefined) {

      console.warn('THREE.Vector2: .add() now only accepts one argument. Use .addVectors( a, b ) instead.');
      return this.addVectors(v, w);

    }

    this.x += v.x;
    this.y += v.y;

    return this;

  }

  addScalar(s) {

    this.x += s;
    this.y += s;

    return this;

  }

  addVectors(a, b) {

    this.x = a.x + b.x;
    this.y = a.y + b.y;

    return this;

  }

  addScaledVector(v, s) {

    this.x += v.x * s;
    this.y += v.y * s;

    return this;

  }

  sub(v, w) {

    if (w !== undefined) {

      console.warn('THREE.Vector2: .sub() now only accepts one argument. Use .subVectors( a, b ) instead.');
      return this.subVectors(v, w);

    }

    this.x -= v.x;
    this.y -= v.y;

    return this;

  }

  subScalar(s) {

    this.x -= s;
    this.y -= s;

    return this;

  }

  subVectors(a, b) {

    this.x = a.x - b.x;
    this.y = a.y - b.y;

    return this;

  }

  multiply(v) {

    this.x *= v.x;
    this.y *= v.y;

    return this;

  }

  multiplyScalar(scalar) {

    this.x *= scalar;
    this.y *= scalar;

    return this;

  }

  divide(v) {

    this.x /= v.x;
    this.y /= v.y;

    return this;

  }

  divideScalar(scalar) {

    return this.multiplyScalar(1 / scalar);

  }

  applyMatrix3(m) {

    const x = this.x,
      y = this.y;
    const e = m.elements;

    this.x = e[0] * x + e[3] * y + e[6];
    this.y = e[1] * x + e[4] * y + e[7];

    return this;

  }

  min(v) {

    this.x = Math.min(this.x, v.x);
    this.y = Math.min(this.y, v.y);

    return this;

  }

  max(v) {

    this.x = Math.max(this.x, v.x);
    this.y = Math.max(this.y, v.y);

    return this;

  }

  clamp(min, max) {

    // assumes min < max, componentwise

    this.x = Math.max(min.x, Math.min(max.x, this.x));
    this.y = Math.max(min.y, Math.min(max.y, this.y));

    return this;

  }

  clampScalar(minVal, maxVal) {

    this.x = Math.max(minVal, Math.min(maxVal, this.x));
    this.y = Math.max(minVal, Math.min(maxVal, this.y));

    return this;

  }

  clampLength(min, max) {

    const length = this.length();

    return this.divideScalar(length || 1).multiplyScalar(Math.max(min, Math.min(max, length)));

  }

  floor() {

    this.x = Math.floor(this.x);
    this.y = Math.floor(this.y);

    return this;

  }

  ceil() {

    this.x = Math.ceil(this.x);
    this.y = Math.ceil(this.y);

    return this;

  }

  round() {

    this.x = Math.round(this.x);
    this.y = Math.round(this.y);

    return this;

  }

  roundToZero() {

    this.x = (this.x < 0) ? Math.ceil(this.x) : Math.floor(this.x);
    this.y = (this.y < 0) ? Math.ceil(this.y) : Math.floor(this.y);

    return this;

  }

  negate() {

    this.x = -this.x;
    this.y = -this.y;

    return this;

  }

  dot(v) {

    return this.x * v.x + this.y * v.y;

  }

  cross(v) {

    return this.x * v.y - this.y * v.x;

  }

  lengthSq() {

    return this.x * this.x + this.y * this.y;

  }

  length() {

    return Math.sqrt(this.x * this.x + this.y * this.y);

  }

  manhattanLength() {

    return Math.abs(this.x) + Math.abs(this.y);

  }

  normalize() {

    return this.divideScalar(this.length() || 1);

  }

  angle() {

    // computes the angle in radians with respect to the positive x-axis

    const angle = Math.atan2(-this.y, -this.x) + Math.PI;

    return angle;

  }

  distanceTo(v) {

    return Math.sqrt(this.distanceToSquared(v));

  }

  distanceToSquared(v) {

    const dx = this.x - v.x,
      dy = this.y - v.y;
    return dx * dx + dy * dy;

  }

  manhattanDistanceTo(v) {

    return Math.abs(this.x - v.x) + Math.abs(this.y - v.y);

  }

  setLength(length) {

    return this.normalize().multiplyScalar(length);

  }

  lerp(v, alpha) {

    this.x += (v.x - this.x) * alpha;
    this.y += (v.y - this.y) * alpha;

    return this;

  }

  lerpVectors(v1, v2, alpha) {

    this.x = v1.x + (v2.x - v1.x) * alpha;
    this.y = v1.y + (v2.y - v1.y) * alpha;

    return this;

  }

  equals(v) {

    return ((v.x === this.x) && (v.y === this.y));

  }

  fromArray(array, offset = 0) {

    this.x = array[offset];
    this.y = array[offset + 1];

    return this;

  }

  toArray(array = [], offset = 0) {

    array[offset] = this.x;
    array[offset + 1] = this.y;

    return array;

  }

  fromBufferAttribute(attribute, index, offset) {

    if (offset !== undefined) {

      console.warn('THREE.Vector2: offset has been removed from .fromBufferAttribute().');

    }

    this.x = attribute.getX(index);
    this.y = attribute.getY(index);

    return this;

  }

  rotateAround(center, angle) {

    const c = Math.cos(angle),
      s = Math.sin(angle);

    const x = this.x - center.x;
    const y = this.y - center.y;

    this.x = x * c - y * s + center.x;
    this.y = x * s + y * c + center.y;

    return this;

  }

  random() {

    this.x = Math.random();
    this.y = Math.random();

    return this;

  }

  * [ Symbol.iterator]() {

    yield this.x;
    yield this.y;

  }

}

Vector2.prototype.isVector2 = true;

const _colorKeywords = {
  'aliceblue': 0xF0F8FF,
  'antiquewhite': 0xFAEBD7,
  'aqua': 0x00FFFF,
  'aquamarine': 0x7FFFD4,
  'azure': 0xF0FFFF,
  'beige': 0xF5F5DC,
  'bisque': 0xFFE4C4,
  'black': 0x000000,
  'blanchedalmond': 0xFFEBCD,
  'blue': 0x0000FF,
  'blueviolet': 0x8A2BE2,
  'brown': 0xA52A2A,
  'burlywood': 0xDEB887,
  'cadetblue': 0x5F9EA0,
  'chartreuse': 0x7FFF00,
  'chocolate': 0xD2691E,
  'coral': 0xFF7F50,
  'cornflowerblue': 0x6495ED,
  'cornsilk': 0xFFF8DC,
  'crimson': 0xDC143C,
  'cyan': 0x00FFFF,
  'darkblue': 0x00008B,
  'darkcyan': 0x008B8B,
  'darkgoldenrod': 0xB8860B,
  'darkgray': 0xA9A9A9,
  'darkgreen': 0x006400,
  'darkgrey': 0xA9A9A9,
  'darkkhaki': 0xBDB76B,
  'darkmagenta': 0x8B008B,
  'darkolivegreen': 0x556B2F,
  'darkorange': 0xFF8C00,
  'darkorchid': 0x9932CC,
  'darkred': 0x8B0000,
  'darksalmon': 0xE9967A,
  'darkseagreen': 0x8FBC8F,
  'darkslateblue': 0x483D8B,
  'darkslategray': 0x2F4F4F,
  'darkslategrey': 0x2F4F4F,
  'darkturquoise': 0x00CED1,
  'darkviolet': 0x9400D3,
  'deeppink': 0xFF1493,
  'deepskyblue': 0x00BFFF,
  'dimgray': 0x696969,
  'dimgrey': 0x696969,
  'dodgerblue': 0x1E90FF,
  'firebrick': 0xB22222,
  'floralwhite': 0xFFFAF0,
  'forestgreen': 0x228B22,
  'fuchsia': 0xFF00FF,
  'gainsboro': 0xDCDCDC,
  'ghostwhite': 0xF8F8FF,
  'gold': 0xFFD700,
  'goldenrod': 0xDAA520,
  'gray': 0x808080,
  'green': 0x008000,
  'greenyellow': 0xADFF2F,
  'grey': 0x808080,
  'honeydew': 0xF0FFF0,
  'hotpink': 0xFF69B4,
  'indianred': 0xCD5C5C,
  'indigo': 0x4B0082,
  'ivory': 0xFFFFF0,
  'khaki': 0xF0E68C,
  'lavender': 0xE6E6FA,
  'lavenderblush': 0xFFF0F5,
  'lawngreen': 0x7CFC00,
  'lemonchiffon': 0xFFFACD,
  'lightblue': 0xADD8E6,
  'lightcoral': 0xF08080,
  'lightcyan': 0xE0FFFF,
  'lightgoldenrodyellow': 0xFAFAD2,
  'lightgray': 0xD3D3D3,
  'lightgreen': 0x90EE90,
  'lightgrey': 0xD3D3D3,
  'lightpink': 0xFFB6C1,
  'lightsalmon': 0xFFA07A,
  'lightseagreen': 0x20B2AA,
  'lightskyblue': 0x87CEFA,
  'lightslategray': 0x778899,
  'lightslategrey': 0x778899,
  'lightsteelblue': 0xB0C4DE,
  'lightyellow': 0xFFFFE0,
  'lime': 0x00FF00,
  'limegreen': 0x32CD32,
  'linen': 0xFAF0E6,
  'magenta': 0xFF00FF,
  'maroon': 0x800000,
  'mediumaquamarine': 0x66CDAA,
  'mediumblue': 0x0000CD,
  'mediumorchid': 0xBA55D3,
  'mediumpurple': 0x9370DB,
  'mediumseagreen': 0x3CB371,
  'mediumslateblue': 0x7B68EE,
  'mediumspringgreen': 0x00FA9A,
  'mediumturquoise': 0x48D1CC,
  'mediumvioletred': 0xC71585,
  'midnightblue': 0x191970,
  'mintcream': 0xF5FFFA,
  'mistyrose': 0xFFE4E1,
  'moccasin': 0xFFE4B5,
  'navajowhite': 0xFFDEAD,
  'navy': 0x000080,
  'oldlace': 0xFDF5E6,
  'olive': 0x808000,
  'olivedrab': 0x6B8E23,
  'orange': 0xFFA500,
  'orangered': 0xFF4500,
  'orchid': 0xDA70D6,
  'palegoldenrod': 0xEEE8AA,
  'palegreen': 0x98FB98,
  'paleturquoise': 0xAFEEEE,
  'palevioletred': 0xDB7093,
  'papayawhip': 0xFFEFD5,
  'peachpuff': 0xFFDAB9,
  'peru': 0xCD853F,
  'pink': 0xFFC0CB,
  'plum': 0xDDA0DD,
  'powderblue': 0xB0E0E6,
  'purple': 0x800080,
  'rebeccapurple': 0x663399,
  'red': 0xFF0000,
  'rosybrown': 0xBC8F8F,
  'royalblue': 0x4169E1,
  'saddlebrown': 0x8B4513,
  'salmon': 0xFA8072,
  'sandybrown': 0xF4A460,
  'seagreen': 0x2E8B57,
  'seashell': 0xFFF5EE,
  'sienna': 0xA0522D,
  'silver': 0xC0C0C0,
  'skyblue': 0x87CEEB,
  'slateblue': 0x6A5ACD,
  'slategray': 0x708090,
  'slategrey': 0x708090,
  'snow': 0xFFFAFA,
  'springgreen': 0x00FF7F,
  'steelblue': 0x4682B4,
  'tan': 0xD2B48C,
  'teal': 0x008080,
  'thistle': 0xD8BFD8,
  'tomato': 0xFF6347,
  'turquoise': 0x40E0D0,
  'violet': 0xEE82EE,
  'wheat': 0xF5DEB3,
  'white': 0xFFFFFF,
  'whitesmoke': 0xF5F5F5,
  'yellow': 0xFFFF00,
  'yellowgreen': 0x9ACD32
};

const _hslA = {
  h: 0,
  s: 0,
  l: 0
};
const _hslB = {
  h: 0,
  s: 0,
  l: 0
};

function hue2rgb(p, q, t) {
  if (t < 0)
    t += 1;
  if (t > 1)
    t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * 6 * (2 / 3 - t);
  return p;
}

function SRGBToLinear(c) {
  return (c < 0.04045) ? c * 0.0773993808 : Math.pow(c * 0.9478672986 + 0.0521327014, 2.4);
}

function LinearToSRGB(c) {
  return (c < 0.0031308) ? c * 12.92 : 1.055 * ( Math.pow(c, 0.41666) ) - 0.055;
}

class Color {

  constructor(r, g, b) {

    if (g === undefined && b === undefined) {

      // r is THREE.Color, hex or string
      return this.set(r);

    }

    return this.setRGB(r, g, b);

  }

  set(value) {

    if (value && value.isColor) {

      this.copy(value);

    } else if (typeof value === 'number') {

      this.setHex(value);

    } else if (typeof value === 'string') {

      this.setStyle(value);

    }

    return this;

  }

  setScalar(scalar) {

    this.r = scalar;
    this.g = scalar;
    this.b = scalar;

    return this;

  }

  setHex(hex) {

    hex = Math.floor(hex);

    this.r = (hex >> 16 & 255) / 255;
    this.g = (hex >> 8 & 255) / 255;
    this.b = (hex & 255) / 255;

    return this;

  }

  setRGB(r, g, b) {

    this.r = r;
    this.g = g;
    this.b = b;

    return this;

  }

  setHSL(h, s, l) {

    // h,s,l ranges are in 0.0 - 1.0
    h = euclideanModulo(h, 1);
    s = clamp(s, 0, 1);
    l = clamp(l, 0, 1);

    if (s === 0) {

      this.r = this.g = this.b = l;

    } else {

      const p = l <= 0.5 ? l * (1 + s) : l + s - (l * s);
      const q = (2 * l) - p;

      this.r = hue2rgb(q, p, h + 1 / 3);
      this.g = hue2rgb(q, p, h);
      this.b = hue2rgb(q, p, h - 1 / 3);

    }

    return this;

  }

  setStyle(style) {

    function handleAlpha(string) {
      if (string === undefined) return;

      if (parseFloat(string) < 1) {

        console.warn('THREE.Color: Alpha component of ' + style + ' will be ignored.');

      }
    }


    let m;

    if (m = /^((?:rgb|hsl)a?)\(([^\)]*)\)/.exec(style)) {

      // rgb / hsl

      let color;
      const name = m[1];
      const components = m[2];

      switch (name) {

        case 'rgb':
        case 'rgba':

          if (color = /^\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(components)) {

            // rgb(255,0,0) rgba(255,0,0,0.5)
            this.r = Math.min(255, parseInt(color[1], 10)) / 255;
            this.g = Math.min(255, parseInt(color[2], 10)) / 255;
            this.b = Math.min(255, parseInt(color[3], 10)) / 255;

            handleAlpha(color[4]);

            return this;

          }

          if (color = /^\s*(\d+)\%\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(components)) {

            // rgb(100%,0%,0%) rgba(100%,0%,0%,0.5)
            this.r = Math.min(100, parseInt(color[1], 10)) / 100;
            this.g = Math.min(100, parseInt(color[2], 10)) / 100;
            this.b = Math.min(100, parseInt(color[3], 10)) / 100;

            handleAlpha(color[4]);

            return this;

          }

          break;

        case 'hsl':
        case 'hsla':

          if (color = /^\s*(\d*\.?\d+)\s*,\s*(\d+)\%\s*,\s*(\d+)\%\s*(?:,\s*(\d*\.?\d+)\s*)?$/.exec(components)) {

            // hsl(120,50%,50%) hsla(120,50%,50%,0.5)
            const h = parseFloat(color[1]) / 360;
            const s = parseInt(color[2], 10) / 100;
            const l = parseInt(color[3], 10) / 100;

            handleAlpha(color[4]);

            return this.setHSL(h, s, l);

          }

          break;

      }

    } else if (m = /^\#([A-Fa-f\d]+)$/.exec(style)) {

      // hex color

      const hex = m[1];
      const size = hex.length;

      if (size === 3) {

        // #ff0
        this.r = parseInt(hex.charAt(0) + hex.charAt(0), 16) / 255;
        this.g = parseInt(hex.charAt(1) + hex.charAt(1), 16) / 255;
        this.b = parseInt(hex.charAt(2) + hex.charAt(2), 16) / 255;

        return this;

      } else if (size === 6) {

        // #ff0000
        this.r = parseInt(hex.charAt(0) + hex.charAt(1), 16) / 255;
        this.g = parseInt(hex.charAt(2) + hex.charAt(3), 16) / 255;
        this.b = parseInt(hex.charAt(4) + hex.charAt(5), 16) / 255;

        return this;

      }

    }

    if (style && style.length > 0) {

      return this.setColorName(style);

    }

    return this;

  }

  setColorName(style) {

    // color keywords
    const hex = _colorKeywords[style.toLowerCase()];

    if (hex !== undefined) {

      // red
      this.setHex(hex);

    } else {

      // unknown color
      console.warn('THREE.Color: Unknown color ' + style);

    }

    return this;

  }

  clone() {

    return new this.constructor(this.r, this.g, this.b);

  }

  copy(color) {

    this.r = color.r;
    this.g = color.g;
    this.b = color.b;

    return this;

  }

  copyGammaToLinear(color, gammaFactor = 2.0) {

    this.r = Math.pow(color.r, gammaFactor);
    this.g = Math.pow(color.g, gammaFactor);
    this.b = Math.pow(color.b, gammaFactor);

    return this;

  }

  copyLinearToGamma(color, gammaFactor = 2.0) {

    const safeInverse = (gammaFactor > 0) ? (1.0 / gammaFactor) : 1.0;

    this.r = Math.pow(color.r, safeInverse);
    this.g = Math.pow(color.g, safeInverse);
    this.b = Math.pow(color.b, safeInverse);

    return this;

  }

  convertGammaToLinear(gammaFactor) {

    this.copyGammaToLinear(this, gammaFactor);

    return this;

  }

  convertLinearToGamma(gammaFactor) {

    this.copyLinearToGamma(this, gammaFactor);

    return this;

  }

  copySRGBToLinear(color) {

    this.r = SRGBToLinear(color.r);
    this.g = SRGBToLinear(color.g);
    this.b = SRGBToLinear(color.b);

    return this;

  }

  copyLinearToSRGB(color) {

    this.r = LinearToSRGB(color.r);
    this.g = LinearToSRGB(color.g);
    this.b = LinearToSRGB(color.b);

    return this;

  }

  convertSRGBToLinear() {

    this.copySRGBToLinear(this);

    return this;

  }

  convertLinearToSRGB() {

    this.copyLinearToSRGB(this);

    return this;

  }

  getHex() {

    return (this.r * 255) << 16 ^ (this.g * 255) << 8 ^ (this.b * 255) << 0;

  }

  getHexString() {

    return ('000000' + this.getHex().toString(16)).slice(-6);

  }

  getHSL(target) {

    // h,s,l ranges are in 0.0 - 1.0

    const r = this.r,
      g = this.g,
      b = this.b;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);

    let hue,
      saturation;
    const lightness = (min + max) / 2.0;

    if (min === max) {

      hue = 0;
      saturation = 0;

    } else {

      const delta = max - min;

      saturation = lightness <= 0.5 ? delta / (max + min) : delta / (2 - max - min);

      switch (max) {

        case r:
          hue = (g - b) / delta + (g < b ? 6 : 0);
          break;
        case g:
          hue = (b - r) / delta + 2;
          break;
        case b:
          hue = (r - g) / delta + 4;
          break;

      }

      hue /= 6;

    }

    target.h = hue;
    target.s = saturation;
    target.l = lightness;

    return target;

  }

  getStyle() {

    return 'rgb(' + ((this.r * 255) | 0) + ',' + ((this.g * 255) | 0) + ',' + ((this.b * 255) | 0) + ')';

  }

  offsetHSL(h, s, l) {

    this.getHSL(_hslA);

    _hslA.h += h;
    _hslA.s += s;
    _hslA.l += l;

    this.setHSL(_hslA.h, _hslA.s, _hslA.l);

    return this;

  }

  add(color) {

    this.r += color.r;
    this.g += color.g;
    this.b += color.b;

    return this;

  }

  addColors(color1, color2) {

    this.r = color1.r + color2.r;
    this.g = color1.g + color2.g;
    this.b = color1.b + color2.b;

    return this;

  }

  addScalar(s) {

    this.r += s;
    this.g += s;
    this.b += s;

    return this;

  }

  sub(color) {

    this.r = Math.max(0, this.r - color.r);
    this.g = Math.max(0, this.g - color.g);
    this.b = Math.max(0, this.b - color.b);

    return this;

  }

  multiply(color) {

    this.r *= color.r;
    this.g *= color.g;
    this.b *= color.b;

    return this;

  }

  multiplyScalar(s) {

    this.r *= s;
    this.g *= s;
    this.b *= s;

    return this;

  }

  lerp(color, alpha) {

    this.r += (color.r - this.r) * alpha;
    this.g += (color.g - this.g) * alpha;
    this.b += (color.b - this.b) * alpha;

    return this;

  }

  lerpColors(color1, color2, alpha) {

    this.r = color1.r + (color2.r - color1.r) * alpha;
    this.g = color1.g + (color2.g - color1.g) * alpha;
    this.b = color1.b + (color2.b - color1.b) * alpha;

    return this;

  }

  lerpHSL(color, alpha) {

    this.getHSL(_hslA);
    color.getHSL(_hslB);

    const h = lerp(_hslA.h, _hslB.h, alpha);
    const s = lerp(_hslA.s, _hslB.s, alpha);
    const l = lerp(_hslA.l, _hslB.l, alpha);

    this.setHSL(h, s, l);

    return this;

  }

  equals(c) {

    return (c.r === this.r) && (c.g === this.g) && (c.b === this.b);

  }

  fromArray(array, offset = 0) {

    this.r = array[offset];
    this.g = array[offset + 1];
    this.b = array[offset + 2];

    return this;

  }

  toArray(array = [], offset = 0) {

    array[offset] = this.r;
    array[offset + 1] = this.g;
    array[offset + 2] = this.b;

    return array;

  }

  fromBufferAttribute(attribute, index) {

    this.r = attribute.getX(index);
    this.g = attribute.getY(index);
    this.b = attribute.getZ(index);

    if (attribute.normalized === true) {

      // assuming Uint8Array

      this.r /= 255;
      this.g /= 255;
      this.b /= 255;

    }

    return this;

  }

  toJSON() {

    return this.getHex();

  }

}

Color.NAMES = _colorKeywords;

Color.prototype.isColor = true;
Color.prototype.r = 1;
Color.prototype.g = 1;
Color.prototype.b = 1;

const StaticDrawUsage = 35044;

const _vector = /*@__PURE__*/ new Vector3();
const _vector2 = /*@__PURE__*/ new Vector2();

class BufferAttribute {

  constructor(array, itemSize, normalized) {

    if (Array.isArray(array)) {

      throw new TypeError('THREE.BufferAttribute: array should be a Typed Array.');

    }

    this.name = '';

    this.array = array;
    this.itemSize = itemSize;
    this.count = array !== undefined ? array.length / itemSize : 0;
    this.normalized = normalized === true;

    this.usage = StaticDrawUsage;
    this.updateRange = {
      offset: 0,
      count: -1
    };

    this.version = 0;

  }

  onUploadCallback() {}

  set needsUpdate(value) {

    if (value === true) this.version++;

  }

  setUsage(value) {

    this.usage = value;

    return this;

  }

  copy(source) {

    this.name = source.name;
    this.array = new source.array.constructor(source.array);
    this.itemSize = source.itemSize;
    this.count = source.count;
    this.normalized = source.normalized;

    this.usage = source.usage;

    return this;

  }

  copyAt(index1, attribute, index2) {

    index1 *= this.itemSize;
    index2 *= attribute.itemSize;

    for (let i = 0, l = this.itemSize; i < l; i++) {

      this.array[index1 + i] = attribute.array[index2 + i];

    }

    return this;

  }

  copyArray(array) {

    this.array.set(array);

    return this;

  }

  copyColorsArray(colors) {

    const array = this.array;
    let offset = 0;

    for (let i = 0, l = colors.length; i < l; i++) {

      let color = colors[i];

      if (color === undefined) {

        console.warn('THREE.BufferAttribute.copyColorsArray(): color is undefined', i);
        color = new Color();

      }

      array[offset++] = color.r;
      array[offset++] = color.g;
      array[offset++] = color.b;

    }

    return this;

  }

  copyVector2sArray(vectors) {

    const array = this.array;
    let offset = 0;

    for (let i = 0, l = vectors.length; i < l; i++) {

      let vector = vectors[i];

      if (vector === undefined) {

        console.warn('THREE.BufferAttribute.copyVector2sArray(): vector is undefined', i);
        vector = new Vector2();

      }

      array[offset++] = vector.x;
      array[offset++] = vector.y;

    }

    return this;

  }

  copyVector3sArray(vectors) {

    const array = this.array;
    let offset = 0;

    for (let i = 0, l = vectors.length; i < l; i++) {

      let vector = vectors[i];

      if (vector === undefined) {

        console.warn('THREE.BufferAttribute.copyVector3sArray(): vector is undefined', i);
        vector = new Vector3();

      }

      array[offset++] = vector.x;
      array[offset++] = vector.y;
      array[offset++] = vector.z;

    }

    return this;

  }

  copyVector4sArray(vectors) {

    const array = this.array;
    let offset = 0;

    for (let i = 0, l = vectors.length; i < l; i++) {

      let vector = vectors[i];

      if (vector === undefined) {

        console.warn('THREE.BufferAttribute.copyVector4sArray(): vector is undefined', i);
        vector = new Vector4();

      }

      array[offset++] = vector.x;
      array[offset++] = vector.y;
      array[offset++] = vector.z;
      array[offset++] = vector.w;

    }

    return this;

  }

  applyMatrix3(m) {

    if (this.itemSize === 2) {

      for (let i = 0, l = this.count; i < l; i++) {

        _vector2.fromBufferAttribute(this, i);
        _vector2.applyMatrix3(m);

        this.setXY(i, _vector2.x, _vector2.y);

      }

    } else if (this.itemSize === 3) {

      for (let i = 0, l = this.count; i < l; i++) {

        _vector.fromBufferAttribute(this, i);
        _vector.applyMatrix3(m);

        this.setXYZ(i, _vector.x, _vector.y, _vector.z);

      }

    }

    return this;

  }

  applyMatrix4(m) {

    for (let i = 0, l = this.count; i < l; i++) {

      _vector.x = this.getX(i);
      _vector.y = this.getY(i);
      _vector.z = this.getZ(i);

      _vector.applyMatrix4(m);

      this.setXYZ(i, _vector.x, _vector.y, _vector.z);

    }

    return this;

  }

  applyNormalMatrix(m) {

    for (let i = 0, l = this.count; i < l; i++) {

      _vector.x = this.getX(i);
      _vector.y = this.getY(i);
      _vector.z = this.getZ(i);

      _vector.applyNormalMatrix(m);

      this.setXYZ(i, _vector.x, _vector.y, _vector.z);

    }

    return this;

  }

  transformDirection(m) {

    for (let i = 0, l = this.count; i < l; i++) {

      _vector.x = this.getX(i);
      _vector.y = this.getY(i);
      _vector.z = this.getZ(i);

      _vector.transformDirection(m);

      this.setXYZ(i, _vector.x, _vector.y, _vector.z);

    }

    return this;

  }

  set(value, offset = 0) {

    this.array.set(value, offset);

    return this;

  }

  getX(index) {

    return this.array[index * this.itemSize];

  }

  setX(index, x) {

    this.array[index * this.itemSize] = x;

    return this;

  }

  getY(index) {

    return this.array[index * this.itemSize + 1];

  }

  setY(index, y) {

    this.array[index * this.itemSize + 1] = y;

    return this;

  }

  getZ(index) {

    return this.array[index * this.itemSize + 2];

  }

  setZ(index, z) {

    this.array[index * this.itemSize + 2] = z;

    return this;

  }

  getW(index) {

    return this.array[index * this.itemSize + 3];

  }

  setW(index, w) {

    this.array[index * this.itemSize + 3] = w;

    return this;

  }

  setXY(index, x, y) {

    index *= this.itemSize;

    this.array[index + 0] = x;
    this.array[index + 1] = y;

    return this;

  }

  setXYZ(index, x, y, z) {

    index *= this.itemSize;

    this.array[index + 0] = x;
    this.array[index + 1] = y;
    this.array[index + 2] = z;

    return this;

  }

  setXYZW(index, x, y, z, w) {

    index *= this.itemSize;

    this.array[index + 0] = x;
    this.array[index + 1] = y;
    this.array[index + 2] = z;
    this.array[index + 3] = w;

    return this;

  }

  onUpload(callback) {

    this.onUploadCallback = callback;

    return this;

  }

  clone() {

    return new this.constructor(this.array, this.itemSize).copy(this);

  }

  toJSON() {

    const data = {
      itemSize: this.itemSize,
      type: this.array.constructor.name,
      array: Array.prototype.slice.call(this.array),
      normalized: this.normalized
    };

    if (this.name !== '')
      data.name = this.name;
    if (this.usage !== StaticDrawUsage)
      data.usage = this.usage;
    if (this.updateRange.offset !== 0 || this.updateRange.count !== -1)
      data.updateRange = this.updateRange;

    return data;

  }

}

BufferAttribute.prototype.isBufferAttribute = true;

class Float16BufferAttribute extends BufferAttribute {

  constructor(array, itemSize, normalized) {

    super(new Uint16Array(array), itemSize, normalized);

  }

}

Float16BufferAttribute.prototype.isFloat16BufferAttribute = true;

class GLTFExporter {

  constructor() {

    this.pluginCallbacks = [];

    this.register(function(writer) {

      return new GLTFLightExtension(writer);

    });

    this.register(function(writer) {

      return new GLTFMaterialsUnlitExtension(writer);

    });

    this.register(function(writer) {

      return new GLTFMaterialsPBRSpecularGlossiness(writer);

    });

    this.register(function(writer) {

      return new GLTFMaterialsTransmissionExtension(writer);

    });

    this.register(function(writer) {

      return new GLTFMaterialsVolumeExtension(writer);

    });

    this.register(function(writer) {

      return new GLTFMaterialsClearcoatExtension(writer);

    });

  }

  register(callback) {

    if (this.pluginCallbacks.indexOf(callback) === -1) {

      this.pluginCallbacks.push(callback);

    }

    return this;

  }

  unregister(callback) {

    if (this.pluginCallbacks.indexOf(callback) !== -1) {

      this.pluginCallbacks.splice(this.pluginCallbacks.indexOf(callback), 1);

    }

    return this;

  }

  /**
   * Parse scenes and generate GLTF output
   * @param  {Scene or [THREE.Scenes]} input   Scene or Array of THREE.Scenes
   * @param  {Function} onDone  Callback on completed
   * @param  {Function} onError  Callback on errors
   * @param  {Object} options options
   */

  parse(input, onDone, onError, options) {

    if (typeof onError === 'object') {

      console.warn('THREE.GLTFExporter: parse() expects options as the fourth argument now.');

      options = onError;

    }

    const writer = new GLTFWriter();
    const plugins = [];

    for (let i = 0, il = this.pluginCallbacks.length; i < il; i++) {

      plugins.push(this.pluginCallbacks[i](writer));

    }

    writer.setPlugins(plugins);
    writer.write(input, onDone, options).catch(onError);

  }

  parseAsync(input, options) {

    const scope = this;

    return new Promise(function(resolve, reject) {

      scope.parse(input, resolve, reject, options);

    });

  }

}

//------------------------------------------------------------------------------
// Constants
//------------------------------------------------------------------------------

const WEBGL_CONSTANTS = {
  POINTS: 0x0000,
  LINES: 0x0001,
  LINE_LOOP: 0x0002,
  LINE_STRIP: 0x0003,
  TRIANGLES: 0x0004,
  TRIANGLE_STRIP: 0x0005,
  TRIANGLE_FAN: 0x0006,

  UNSIGNED_BYTE: 0x1401,
  UNSIGNED_SHORT: 0x1403,
  FLOAT: 0x1406,
  UNSIGNED_INT: 0x1405,
  ARRAY_BUFFER: 0x8892,
  ELEMENT_ARRAY_BUFFER: 0x8893,

  NEAREST: 0x2600,
  LINEAR: 0x2601,
  NEAREST_MIPMAP_NEAREST: 0x2700,
  LINEAR_MIPMAP_NEAREST: 0x2701,
  NEAREST_MIPMAP_LINEAR: 0x2702,
  LINEAR_MIPMAP_LINEAR: 0x2703,

  CLAMP_TO_EDGE: 33071,
  MIRRORED_REPEAT: 33648,
  REPEAT: 10497
};

const THREE_TO_WEBGL = {};

THREE_TO_WEBGL[NearestFilter] = WEBGL_CONSTANTS.NEAREST;
THREE_TO_WEBGL[NearestMipmapNearestFilter] = WEBGL_CONSTANTS.NEAREST_MIPMAP_NEAREST;
THREE_TO_WEBGL[NearestMipmapLinearFilter] = WEBGL_CONSTANTS.NEAREST_MIPMAP_LINEAR;
THREE_TO_WEBGL[LinearFilter] = WEBGL_CONSTANTS.LINEAR;
THREE_TO_WEBGL[LinearMipmapNearestFilter] = WEBGL_CONSTANTS.LINEAR_MIPMAP_NEAREST;
THREE_TO_WEBGL[LinearMipmapLinearFilter] = WEBGL_CONSTANTS.LINEAR_MIPMAP_LINEAR;

THREE_TO_WEBGL[ClampToEdgeWrapping] = WEBGL_CONSTANTS.CLAMP_TO_EDGE;
THREE_TO_WEBGL[RepeatWrapping] = WEBGL_CONSTANTS.REPEAT;
THREE_TO_WEBGL[MirroredRepeatWrapping] = WEBGL_CONSTANTS.MIRRORED_REPEAT;

const PATH_PROPERTIES = {
  scale: 'scale',
  position: 'translation',
  quaternion: 'rotation',
  morphTargetInfluences: 'weights'
};

// GLB constants
// https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#glb-file-format-specification

const GLB_HEADER_BYTES = 12;
const GLB_HEADER_MAGIC = 0x46546C67;
const GLB_VERSION = 2;

const GLB_CHUNK_PREFIX_BYTES = 8;
const GLB_CHUNK_TYPE_JSON = 0x4E4F534A;
const GLB_CHUNK_TYPE_BIN = 0x004E4942;

//------------------------------------------------------------------------------
// Utility functions
//------------------------------------------------------------------------------

/**
 * Compare two arrays
 * @param  {Array} array1 Array 1 to compare
 * @param  {Array} array2 Array 2 to compare
 * @return {Boolean}        Returns true if both arrays are equal
 */

function equalArray(array1, array2) {
  return (array1.length === array2.length) && array1.every(function(element, index) {

      return element === array2[index];

  });
}

/**
 * Converts a string to an ArrayBuffer.
 * @param  {string} text
 * @return {ArrayBuffer}
 */

function stringToArrayBuffer(text) {
  if (window.TextEncoder !== undefined) {

    return new TextEncoder().encode(text).buffer;

  }

  const array = new Uint8Array(new ArrayBuffer(text.length));

  for (let i = 0, il = text.length; i < il; i++) {

    const value = text.charCodeAt(i);

    // Replacing multi-byte character with space(0x20).
    array[i] = value > 0xFF ? 0x20 : value;

  }

  return array.buffer;
}

/**
 * Is identity matrix
 *
 * @param {Matrix4} matrix
 * @returns {Boolean} Returns true, if parameter is identity matrix
 */

function isIdentityMatrix(matrix) {
  return equalArray(matrix.elements, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/**
 * Get the min and max vectors from the given attribute
 * @param  {BufferAttribute} attribute Attribute to find the min/max in range from start to start + count
 * @param  {Integer} start
 * @param  {Integer} count
 * @return {Object} Object containing the `min` and `max` values (As an array of attribute.itemSize components)
 */

function getMinMax(attribute, start, count) {
  const output = {

    min: new Array(attribute.itemSize).fill(Number.POSITIVE_INFINITY),
    max: new Array(attribute.itemSize).fill(Number.NEGATIVE_INFINITY)

  };

  for (let i = start; i < start + count; i++) {

    for (let a = 0; a < attribute.itemSize; a++) {

      let value;

      if (attribute.itemSize > 4) {

        // no support for interleaved data for itemSize > 4

        value = attribute.array[i * attribute.itemSize + a];

      } else {

        if (a === 0)
          value = attribute.getX(i);
        else if (a === 1)
          value = attribute.getY(i);
        else if (a === 2)
          value = attribute.getZ(i);
        else if (a === 3)
          value = attribute.getW(i);

      }

      output.min[a] = Math.min(output.min[a], value);
      output.max[a] = Math.max(output.max[a], value);

    }

  }

  return output;
}

/**
 * Get the required size + padding for a buffer, rounded to the next 4-byte boundary.
 * https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#data-alignment
 *
 * @param {Integer} bufferSize The size the original buffer.
 * @returns {Integer} new buffer size with required padding.
 *
 */

function getPaddedBufferSize(bufferSize) {
  return Math.ceil(bufferSize / 4) * 4;
}

/**
 * Returns a buffer aligned to 4-byte boundary.
 *
 * @param {ArrayBuffer} arrayBuffer Buffer to pad
 * @param {Integer} paddingByte (Optional)
 * @returns {ArrayBuffer} The same buffer if it's already aligned to 4-byte boundary or a new buffer
 */

function getPaddedArrayBuffer(arrayBuffer, paddingByte = 0) {
  const paddedLength = getPaddedBufferSize(arrayBuffer.byteLength);

  if (paddedLength !== arrayBuffer.byteLength) {

    const array = new Uint8Array(paddedLength);
    array.set(new Uint8Array(arrayBuffer));

    if (paddingByte !== 0) {

      for (let i = arrayBuffer.byteLength; i < paddedLength; i++) {

        array[i] = paddingByte;

      }

    }

    return array.buffer;

  }

  return arrayBuffer;
}

let cachedCanvas = null;

/**
 * Writer
 */

class GLTFWriter {

  constructor() {

    this.plugins = [];

    this.options = {};
    this.pending = [];
    this.buffers = [];

    this.byteOffset = 0;
    this.buffers = [];
    this.nodeMap = new Map();
    this.skins = [];
    this.extensionsUsed = {};

    this.uids = new Map();
    this.uid = 0;

    this.json = {
      asset: {
        version: '2.0',
        generator: 'THREE.GLTFExporter'
      }
    };

    this.cache = {
      meshes: new Map(),
      attributes: new Map(),
      attributesNormalized: new Map(),
      materials: new Map(),
      textures: new Map(),
      images: new Map()
    };

  }

  setPlugins(plugins) {

    this.plugins = plugins;

  }

  /**
   * Parse scenes and generate GLTF output
   * @param  {Scene or [THREE.Scenes]} input   Scene or Array of THREE.Scenes
   * @param  {Function} onDone  Callback on completed
   * @param  {Object} options options
   */

  async write(input, onDone, options) {

    this.options = Object.assign({}, {
      // default options
      binary: false,
      trs: false,
      onlyVisible: true,
      truncateDrawRange: true,
      embedImages: true,
      maxTextureSize: Infinity,
      animations: [],
      includeCustomExtensions: false
    }, options);

    if (this.options.animations.length > 0) {

      // Only TRS properties, and not matrices, may be targeted by animation.
      this.options.trs = true;

    }

    this.processInput(input);

    await Promise.all(this.pending);

    const writer = this;
    const buffers = writer.buffers;
    const json = writer.json;
    options = writer.options;
    const extensionsUsed = writer.extensionsUsed;

    // Merge buffers.
    const blob = new Blob(buffers, {
      type: 'application/octet-stream'
    });

    // Declare extensions.
    const extensionsUsedList = Object.keys(extensionsUsed);

    if (extensionsUsedList.length > 0)
      json.extensionsUsed = extensionsUsedList;

    // Update bytelength of the single buffer.
    if (json.buffers && json.buffers.length > 0)
      json.buffers[0].byteLength = blob.size;

    if (options.binary === true) {

      // https://github.com/KhronosGroup/glTF/blob/master/specification/2.0/README.md#glb-file-format-specification

      const reader = new window.FileReader();
      reader.readAsArrayBuffer(blob);
      reader.onloadend = function() {

        // Binary chunk.
        const binaryChunk = getPaddedArrayBuffer(reader.result);
        const binaryChunkPrefix = new DataView(new ArrayBuffer(GLB_CHUNK_PREFIX_BYTES));
        binaryChunkPrefix.setUint32(0, binaryChunk.byteLength, true);
        binaryChunkPrefix.setUint32(4, GLB_CHUNK_TYPE_BIN, true);

        // JSON chunk.
        const jsonChunk = getPaddedArrayBuffer(stringToArrayBuffer(JSON.stringify(json)), 0x20);
        const jsonChunkPrefix = new DataView(new ArrayBuffer(GLB_CHUNK_PREFIX_BYTES));
        jsonChunkPrefix.setUint32(0, jsonChunk.byteLength, true);
        jsonChunkPrefix.setUint32(4, GLB_CHUNK_TYPE_JSON, true);

        // GLB header.
        const header = new ArrayBuffer(GLB_HEADER_BYTES);
        const headerView = new DataView(header);
        headerView.setUint32(0, GLB_HEADER_MAGIC, true);
        headerView.setUint32(4, GLB_VERSION, true);
        const totalByteLength = GLB_HEADER_BYTES
        + jsonChunkPrefix.byteLength + jsonChunk.byteLength
        + binaryChunkPrefix.byteLength + binaryChunk.byteLength;
        headerView.setUint32(8, totalByteLength, true);

        const glbBlob = new Blob([
          header,
          jsonChunkPrefix,
          jsonChunk,
          binaryChunkPrefix,
          binaryChunk
        ], {
          type: 'application/octet-stream'
        });

        const glbReader = new window.FileReader();
        glbReader.readAsArrayBuffer(glbBlob);
        glbReader.onloadend = function() {

          onDone(glbReader.result);

        };

      };

    } else {

      if (json.buffers && json.buffers.length > 0) {

        const reader = new window.FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = function() {

          const base64data = reader.result;
          json.buffers[0].uri = base64data;
          onDone(json);

        };

      } else {

        onDone(json);

      }

    }


  }

  /**
   * Serializes a userData.
   *
   * @param {THREE.Object3D|THREE.Material} object
   * @param {Object} objectDef
   */

  serializeUserData(object, objectDef) {

    if (Object.keys(object.userData).length === 0) return;

    const options = this.options;
    const extensionsUsed = this.extensionsUsed;

    try {

      const json = JSON.parse(JSON.stringify(object.userData));

      if (options.includeCustomExtensions && json.gltfExtensions) {

        if (objectDef.extensions === undefined)
          objectDef.extensions = {};

        for (const extensionName in json.gltfExtensions) {

          objectDef.extensions[extensionName] = json.gltfExtensions[extensionName];
          extensionsUsed[extensionName] = true;

        }

        delete json.gltfExtensions;

      }

      if (Object.keys(json).length > 0)
        objectDef.extras = json;

    } catch (error) {

      console.warn('THREE.GLTFExporter: userData of \'' + object.name + '\' ' +
        'won\'t be serialized because of JSON.stringify error - ' + error.message);

    }

  }

  /**
   * Assign and return a temporal unique id for an object
   * especially which doesn't have .uuid
   * @param  {Object} object
   * @return {Integer}
   */

  getUID(object) {

    if (!this.uids.has(object)) this.uids.set(object, this.uid++);

    return this.uids.get(object);

  }

  /**
   * Checks if normal attribute values are normalized.
   *
   * @param {BufferAttribute} normal
   * @returns {Boolean}
   */

  isNormalizedNormalAttribute(normal) {

    const cache = this.cache;

    if (cache.attributesNormalized.has(normal)) return false;

    const v = new Vector3$1();

    for (let i = 0, il = normal.count; i < il; i++) {

      // 0.0005 is from glTF-validator
      if (Math.abs(v.fromBufferAttribute(normal, i).length() - 1.0) > 0.0005) return false;

    }

    return true;

  }

  /**
   * Creates normalized normal buffer attribute.
   *
   * @param {BufferAttribute} normal
   * @returns {BufferAttribute}
   *
   */

  createNormalizedNormalAttribute(normal) {

    const cache = this.cache;

    if (cache.attributesNormalized.has(normal)) return cache.attributesNormalized.get(normal);

    const attribute = normal.clone();
    const v = new Vector3$1();

    for (let i = 0, il = attribute.count; i < il; i++) {

      v.fromBufferAttribute(attribute, i);

      if (v.x === 0 && v.y === 0 && v.z === 0) {

        // if values can't be normalized set (1, 0, 0)
        v.setX(1.0);

      } else {

        v.normalize();

      }

      attribute.setXYZ(i, v.x, v.y, v.z);

    }

    cache.attributesNormalized.set(normal, attribute);

    return attribute;

  }

  /**
   * Applies a texture transform, if present, to the map definition. Requires
   * the KHR_texture_transform extension.
   *
   * @param {Object} mapDef
   * @param {THREE.Texture} texture
   */

  applyTextureTransform(mapDef, texture) {

    let didTransform = false;
    const transformDef = {};

    if (texture.offset.x !== 0 || texture.offset.y !== 0) {

      transformDef.offset = texture.offset.toArray();
      didTransform = true;

    }

    if (texture.rotation !== 0) {

      transformDef.rotation = texture.rotation;
      didTransform = true;

    }

    if (texture.repeat.x !== 1 || texture.repeat.y !== 1) {

      transformDef.scale = texture.repeat.toArray();
      didTransform = true;

    }

    if (didTransform) {

      mapDef.extensions = mapDef.extensions || {};
      mapDef.extensions['KHR_texture_transform'] = transformDef;
      this.extensionsUsed['KHR_texture_transform'] = true;

    }

  }

  /**
   * Process a buffer to append to the default one.
   * @param  {ArrayBuffer} buffer
   * @return {Integer}
   */

  processBuffer(buffer) {

    const json = this.json;
    const buffers = this.buffers;

    if (!json.buffers)
      json.buffers = [{
        byteLength: 0
      }];

    // All buffers are merged before export.
    buffers.push(buffer);

    return 0;

  }

  /**
   * Process and generate a BufferView
   * @param  {BufferAttribute} attribute
   * @param  {number} componentType
   * @param  {number} start
   * @param  {number} count
   * @param  {number} target (Optional) Target usage of the BufferView
   * @return {Object}
   */

  processBufferView(attribute, componentType, start, count, target) {

    const json = this.json;

    if (!json.bufferViews)
      json.bufferViews = [];

    // Create a new dataview and dump the attribute's array into it

    let componentSize;

    if (componentType === WEBGL_CONSTANTS.UNSIGNED_BYTE) {

      componentSize = 1;

    } else if (componentType === WEBGL_CONSTANTS.UNSIGNED_SHORT) {

      componentSize = 2;

    } else {

      componentSize = 4;

    }

    const byteLength = getPaddedBufferSize(count * attribute.itemSize * componentSize);
    const dataView = new DataView(new ArrayBuffer(byteLength));
    let offset = 0;

    for (let i = start; i < start + count; i++) {

      for (let a = 0; a < attribute.itemSize; a++) {

        let value;

        if (attribute.itemSize > 4) {

          // no support for interleaved data for itemSize > 4

          value = attribute.array[i * attribute.itemSize + a];

        } else {

          if (a === 0)
            value = attribute.getX(i);
          else if (a === 1)
            value = attribute.getY(i);
          else if (a === 2)
            value = attribute.getZ(i);
          else if (a === 3)
            value = attribute.getW(i);

        }

        if (componentType === WEBGL_CONSTANTS.FLOAT) {

          dataView.setFloat32(offset, value, true);

        } else if (componentType === WEBGL_CONSTANTS.UNSIGNED_INT) {

          dataView.setUint32(offset, value, true);

        } else if (componentType === WEBGL_CONSTANTS.UNSIGNED_SHORT) {

          dataView.setUint16(offset, value, true);

        } else if (componentType === WEBGL_CONSTANTS.UNSIGNED_BYTE) {

          dataView.setUint8(offset, value);

        }

        offset += componentSize;

      }

    }

    const bufferViewDef = {

      buffer: this.processBuffer(dataView.buffer),
      byteOffset: this.byteOffset,
      byteLength: byteLength

    };

    if (target !== undefined)
      bufferViewDef.target = target;

    if (target === WEBGL_CONSTANTS.ARRAY_BUFFER) {

      // Only define byteStride for vertex attributes.
      bufferViewDef.byteStride = attribute.itemSize * componentSize;

    }

    this.byteOffset += byteLength;

    json.bufferViews.push(bufferViewDef);

    // @TODO Merge bufferViews where possible.
    const output = {

      id: json.bufferViews.length - 1,
      byteLength: 0

    };

    return output;

  }

  /**
   * Process and generate a BufferView from an image Blob.
   * @param {Blob} blob
   * @return {Promise<Integer>}
   */

  processBufferViewImage(blob) {

    const writer = this;
    const json = writer.json;

    if (!json.bufferViews)
      json.bufferViews = [];

    return new Promise(function(resolve) {

      const reader = new window.FileReader();
      reader.readAsArrayBuffer(blob);
      reader.onloadend = function() {

        const buffer = getPaddedArrayBuffer(reader.result);

        const bufferViewDef = {
          buffer: writer.processBuffer(buffer),
          byteOffset: writer.byteOffset,
          byteLength: buffer.byteLength
        };

        writer.byteOffset += buffer.byteLength;
        resolve(json.bufferViews.push(bufferViewDef) - 1);

      };

    });

  }

  /**
   * Process attribute to generate an accessor
   * @param  {BufferAttribute} attribute Attribute to process
   * @param  {THREE.BufferGeometry} geometry (Optional) Geometry used for truncated draw range
   * @param  {Integer} start (Optional)
   * @param  {Integer} count (Optional)
   * @return {Integer|null} Index of the processed accessor on the "accessors" array
   */

  processAccessor(attribute, geometry, start, count) {

    const options = this.options;
    const json = this.json;

    const types = {

      1: 'SCALAR',
      2: 'VEC2',
      3: 'VEC3',
      4: 'VEC4',
      16: 'MAT4'

    };

    let componentType;

    // Detect the component type of the attribute array (float, uint or ushort)
    if (attribute.array.constructor === Float32Array) {

      componentType = WEBGL_CONSTANTS.FLOAT;

    } else if (attribute.array.constructor === Uint32Array) {

      componentType = WEBGL_CONSTANTS.UNSIGNED_INT;

    } else if (attribute.array.constructor === Uint16Array) {

      componentType = WEBGL_CONSTANTS.UNSIGNED_SHORT;

    } else if (attribute.array.constructor === Uint8Array) {

      componentType = WEBGL_CONSTANTS.UNSIGNED_BYTE;

    } else {

      throw new Error('THREE.GLTFExporter: Unsupported bufferAttribute component type.');

    }

    if (start === undefined)
      start = 0;
    if (count === undefined)
      count = attribute.count;

    // @TODO Indexed buffer geometry with drawRange not supported yet
    if (options.truncateDrawRange && geometry !== undefined && geometry.index === null) {

      const end = start + count;
      const end2 = geometry.drawRange.count === Infinity
        ? attribute.count
        : geometry.drawRange.start + geometry.drawRange.count;

      start = Math.max(start, geometry.drawRange.start);
      count = Math.min(end, end2) - start;

      if (count < 0)
        count = 0;

    }

    // Skip creating an accessor if the attribute doesn't have data to export
    if (count === 0) return null;

    const minMax = getMinMax(attribute, start, count);
    let bufferViewTarget;

    // If geometry isn't provided, don't infer the target usage of the bufferView. For
    // animation samplers, target must not be set.
    if (geometry !== undefined) {

      bufferViewTarget = attribute === geometry.index ? WEBGL_CONSTANTS.ELEMENT_ARRAY_BUFFER : WEBGL_CONSTANTS.ARRAY_BUFFER;

    }

    const bufferView = this.processBufferView(attribute, componentType, start, count, bufferViewTarget);

    const accessorDef = {

      bufferView: bufferView.id,
      byteOffset: bufferView.byteOffset,
      componentType: componentType,
      count: count,
      max: minMax.max,
      min: minMax.min,
      type: types[attribute.itemSize]
    };

    if (attribute.normalized === true)
      accessorDef.normalized = true;
    if (!json.accessors)
      json.accessors = [];

    return json.accessors.push(accessorDef) - 1;

  }

  /**
   * Process image
   * @param  {Image} image to process
   * @param  {Integer} format of the image (e.g. RGBFormat, RGBAFormat etc)
   * @param  {Boolean} flipY before writing out the image
   * @return {Integer}     Index of the processed texture in the "images" array
   */

  processImage(image, format, flipY) {

    const writer = this;
    const cache = writer.cache;
    const json = writer.json;
    const options = writer.options;
    const pending = writer.pending;

    if (!cache.images.has(image)) cache.images.set(image, {});

    const cachedImages = cache.images.get(image);
    const mimeType = format === RGBAFormat ? 'image/png' : 'image/jpeg';
    const key = mimeType + ':flipY/' + flipY.toString();

    if (cachedImages[key] !== undefined) return cachedImages[key];

    if (!json.images)
      json.images = [];

    const imageDef = {
      mimeType: mimeType
    };

    if (options.embedImages) {

      const canvas = cachedCanvas = cachedCanvas || document.createElement('canvas');

      canvas.width = Math.min(image.width, options.maxTextureSize);
      canvas.height = Math.min(image.height, options.maxTextureSize);

      const ctx = canvas.getContext('2d');

      if (flipY === true) {

        ctx.translate(0, canvas.height);
        ctx.scale(1, -1);

      }

      if ((typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement) ||
        (typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement) ||
        (typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas) ||
        (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap)) {

        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      } else {

        if (format !== RGBAFormat && format !== RGBFormat) {

          console.error('GLTFExporter: Only RGB and RGBA formats are supported.');

        }

        if (image.width > options.maxTextureSize || image.height > options.maxTextureSize) {

          console.warn('GLTFExporter: Image size is bigger than maxTextureSize', image);

        }

        const data = new Uint8ClampedArray(image.height * image.width * 4);

        if (format === RGBAFormat) {

          for (let i = 0; i < data.length; i += 4) {

            data[i + 0] = image.data[i + 0];
            data[i + 1] = image.data[i + 1];
            data[i + 2] = image.data[i + 2];
            data[i + 3] = image.data[i + 3];

          }

        } else {

          for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {

            data[i + 0] = image.data[j + 0];
            data[i + 1] = image.data[j + 1];
            data[i + 2] = image.data[j + 2];
            data[i + 3] = 255;

          }

        }

        ctx.putImageData(new ImageData(data, image.width, image.height), 0, 0);

      }

      if (options.binary === true) {

        pending.push(new Promise(function(resolve) {

          canvas.toBlob(function(blob) {

            writer.processBufferViewImage(blob).then(function(bufferViewIndex) {

              imageDef.bufferView = bufferViewIndex;
              resolve();

            });

          }, mimeType);

        }));

      } else {

        imageDef.uri = canvas.toDataURL(mimeType);

      }

    } else {

      imageDef.uri = image.src;

    }

    const index = json.images.push(imageDef) - 1;
    cachedImages[key] = index;
    return index;

  }

  /**
   * Process sampler
   * @param  {Texture} map Texture to process
   * @return {Integer}     Index of the processed texture in the "samplers" array
   */

  processSampler(map) {

    const json = this.json;

    if (!json.samplers)
      json.samplers = [];

    const samplerDef = {
      magFilter: THREE_TO_WEBGL[map.magFilter],
      minFilter: THREE_TO_WEBGL[map.minFilter],
      wrapS: THREE_TO_WEBGL[map.wrapS],
      wrapT: THREE_TO_WEBGL[map.wrapT]
    };

    return json.samplers.push(samplerDef) - 1;

  }

  /**
   * Process texture
   * @param  {Texture} map Map to process
   * @return {Integer} Index of the processed texture in the "textures" array
   */

  processTexture(map) {

    const cache = this.cache;
    const json = this.json;

    if (cache.textures.has(map)) return cache.textures.get(map);

    if (!json.textures)
      json.textures = [];

    const textureDef = {
      sampler: this.processSampler(map),
      source: this.processImage(map.image, map.format, map.flipY)
    };

    if (map.name)
      textureDef.name = map.name;

    this._invokeAll(function(ext) {

      ext.writeTexture && ext.writeTexture(map, textureDef);

    });

    const index = json.textures.push(textureDef) - 1;
    cache.textures.set(map, index);
    return index;

  }

  /**
   * Process material
   * @param  {THREE.Material} material Material to process
   * @return {Integer|null} Index of the processed material in the "materials" array
   */

  processMaterial(material) {

    const cache = this.cache;
    const json = this.json;

    if (cache.materials.has(material)) return cache.materials.get(material);

    if (material.isShaderMaterial) {

      console.warn('GLTFExporter: THREE.ShaderMaterial not supported.');
      return null;

    }

    if (!json.materials)
      json.materials = [];

    // @QUESTION Should we avoid including any attribute that has the default value?
    const materialDef = {
      pbrMetallicRoughness: {}
    };

    if (material.isMeshStandardMaterial !== true && material.isMeshBasicMaterial !== true) {

      console.warn('GLTFExporter: Use MeshStandardMaterial or MeshBasicMaterial for best results.');

    }

    // pbrMetallicRoughness.baseColorFactor
    const color = material.color.toArray().concat([material.opacity]);

    if (!equalArray(color, [1, 1, 1, 1])) {

      materialDef.pbrMetallicRoughness.baseColorFactor = color;

    }

    if (material.isMeshStandardMaterial) {

      materialDef.pbrMetallicRoughness.metallicFactor = material.metalness;
      materialDef.pbrMetallicRoughness.roughnessFactor = material.roughness;

    } else {

      materialDef.pbrMetallicRoughness.metallicFactor = 0.5;
      materialDef.pbrMetallicRoughness.roughnessFactor = 0.5;

    }

    // pbrMetallicRoughness.metallicRoughnessTexture
    if (material.metalnessMap || material.roughnessMap) {

      if (material.metalnessMap === material.roughnessMap) {

        const metalRoughMapDef = {
          index: this.processTexture(material.metalnessMap)
        };
        this.applyTextureTransform(metalRoughMapDef, material.metalnessMap);
        materialDef.pbrMetallicRoughness.metallicRoughnessTexture = metalRoughMapDef;

      } else {

        console.warn('THREE.GLTFExporter: Ignoring metalnessMap and roughnessMap because they are not the same Texture.');

      }

    }

    // pbrMetallicRoughness.baseColorTexture or pbrSpecularGlossiness diffuseTexture
    if (material.map) {

      const baseColorMapDef = {
        index: this.processTexture(material.map)
      };
      this.applyTextureTransform(baseColorMapDef, material.map);
      materialDef.pbrMetallicRoughness.baseColorTexture = baseColorMapDef;

    }

    if (material.emissive) {

      // note: emissive components are limited to stay within the 0 - 1 range to accommodate glTF spec. see #21849 and #22000.
      const emissive = material.emissive.clone().multiplyScalar(material.emissiveIntensity);
      const maxEmissiveComponent = Math.max(emissive.r, emissive.g, emissive.b);

      if (maxEmissiveComponent > 1) {

        emissive.multiplyScalar(1 / maxEmissiveComponent);

        console.warn('THREE.GLTFExporter: Some emissive components exceed 1; emissive has been limited');

      }

      if (maxEmissiveComponent > 0) {

        materialDef.emissiveFactor = emissive.toArray();

      }

      // emissiveTexture
      if (material.emissiveMap) {

        const emissiveMapDef = {
          index: this.processTexture(material.emissiveMap)
        };
        this.applyTextureTransform(emissiveMapDef, material.emissiveMap);
        materialDef.emissiveTexture = emissiveMapDef;

      }

    }

    // normalTexture
    if (material.normalMap) {

      const normalMapDef = {
        index: this.processTexture(material.normalMap)
      };

      if (material.normalScale && material.normalScale.x !== 1) {

        // glTF normal scale is univariate. Ignore `y`, which may be flipped.
        // Context: https://github.com/mrdoob/three.js/issues/11438#issuecomment-507003995
        normalMapDef.scale = material.normalScale.x;

      }

      this.applyTextureTransform(normalMapDef, material.normalMap);
      materialDef.normalTexture = normalMapDef;

    }

    // occlusionTexture
    if (material.aoMap) {

      const occlusionMapDef = {
        index: this.processTexture(material.aoMap),
        texCoord: 1
      };

      if (material.aoMapIntensity !== 1.0) {

        occlusionMapDef.strength = material.aoMapIntensity;

      }

      this.applyTextureTransform(occlusionMapDef, material.aoMap);
      materialDef.occlusionTexture = occlusionMapDef;

    }

    // alphaMode
    if (material.transparent) {

      materialDef.alphaMode = 'BLEND';

    } else {

      if (material.alphaTest > 0.0) {

        materialDef.alphaMode = 'MASK';
        materialDef.alphaCutoff = material.alphaTest;

      }

    }

    // doubleSided
    if (material.side === DoubleSide)
      materialDef.doubleSided = true;
    if (material.name !== '')
      materialDef.name = material.name;

    this.serializeUserData(material, materialDef);

    this._invokeAll(function(ext) {

      ext.writeMaterial && ext.writeMaterial(material, materialDef);

    });

    const index = json.materials.push(materialDef) - 1;
    cache.materials.set(material, index);
    return index;

  }

  /**
   * Process mesh
   * @param  {THREE.Mesh} mesh Mesh to process
   * @return {Integer|null} Index of the processed mesh in the "meshes" array
   */

  processMesh(mesh) {

    const cache = this.cache;
    const json = this.json;

    const meshCacheKeyParts = [mesh.geometry.uuid];

    if (Array.isArray(mesh.material)) {

      for (let i = 0, l = mesh.material.length; i < l; i++) {

        meshCacheKeyParts.push(mesh.material[i].uuid);

      }

    } else {

      meshCacheKeyParts.push(mesh.material.uuid);

    }

    const meshCacheKey = meshCacheKeyParts.join(':');

    if (cache.meshes.has(meshCacheKey)) return cache.meshes.get(meshCacheKey);

    const geometry = mesh.geometry;
    let mode;

    // Use the correct mode
    if (mesh.isLineSegments) {

      mode = WEBGL_CONSTANTS.LINES;

    } else if (mesh.isLineLoop) {

      mode = WEBGL_CONSTANTS.LINE_LOOP;

    } else if (mesh.isLine) {

      mode = WEBGL_CONSTANTS.LINE_STRIP;

    } else if (mesh.isPoints) {

      mode = WEBGL_CONSTANTS.POINTS;

    } else {

      mode = mesh.material.wireframe ? WEBGL_CONSTANTS.LINES : WEBGL_CONSTANTS.TRIANGLES;

    }

    if (geometry.isBufferGeometry !== true) {

      throw new Error('THREE.GLTFExporter: Geometry is not of type THREE.BufferGeometry.');

    }

    const meshDef = {};
    const attributes = {};
    const primitives = [];
    const targets = [];

    // Conversion between attributes names in threejs and gltf spec
    const nameConversion = {
      uv: 'TEXCOORD_0',
      uv2: 'TEXCOORD_1',
      color: 'COLOR_0',
      skinWeight: 'WEIGHTS_0',
      skinIndex: 'JOINTS_0'
    };

    const originalNormal = geometry.getAttribute('normal');

    if (originalNormal !== undefined && !this.isNormalizedNormalAttribute(originalNormal)) {

      console.warn('THREE.GLTFExporter: Creating normalized normal attribute from the non-normalized one.');

      geometry.setAttribute('normal', this.createNormalizedNormalAttribute(originalNormal));

    }

    // @QUESTION Detect if .vertexColors = true?
    // For every attribute create an accessor
    let modifiedAttribute = null;

    for (let attributeName in geometry.attributes) {

      // Ignore morph target attributes, which are exported later.
      if (attributeName.substr(0, 5) === 'morph') continue;

      const attribute = geometry.attributes[attributeName];
      attributeName = nameConversion[attributeName] || attributeName.toUpperCase();

      // Prefix all geometry attributes except the ones specifically
      // listed in the spec; non-spec attributes are considered custom.
      const validVertexAttributes = /^(POSITION|NORMAL|TANGENT|TEXCOORD_\d+|COLOR_\d+|JOINTS_\d+|WEIGHTS_\d+)$/;

      if (!validVertexAttributes.test(attributeName))
        attributeName = '_' + attributeName;

      if (cache.attributes.has(this.getUID(attribute))) {

        attributes[attributeName] = cache.attributes.get(this.getUID(attribute));
        continue;

      }

      // JOINTS_0 must be UNSIGNED_BYTE or UNSIGNED_SHORT.
      modifiedAttribute = null;
      const array = attribute.array;

      if (attributeName === 'JOINTS_0' &&
        !(array instanceof Uint16Array) &&
        !(array instanceof Uint8Array)) {

        console.warn('GLTFExporter: Attribute "skinIndex" converted to type UNSIGNED_SHORT.');
        modifiedAttribute = new BufferAttribute$1(new Uint16Array(array), attribute.itemSize, attribute.normalized);

      }

      const accessor = this.processAccessor(modifiedAttribute || attribute, geometry);

      if (accessor !== null) {

        attributes[attributeName] = accessor;
        cache.attributes.set(this.getUID(attribute), accessor);

      }

    }

    if (originalNormal !== undefined) geometry.setAttribute('normal', originalNormal);

    // Skip if no exportable attributes found
    if (Object.keys(attributes).length === 0) return null;

    // Morph targets
    if (mesh.morphTargetInfluences !== undefined && mesh.morphTargetInfluences.length > 0) {

      const weights = [];
      const targetNames = [];
      const reverseDictionary = {};

      if (mesh.morphTargetDictionary !== undefined) {

        for (const key in mesh.morphTargetDictionary) {

          reverseDictionary[mesh.morphTargetDictionary[key]] = key;

        }

      }

      for (let i = 0; i < mesh.morphTargetInfluences.length; ++i) {

        const target = {};
        let warned = false;

        for (const attributeName in geometry.morphAttributes) {

          // glTF 2.0 morph supports only POSITION/NORMAL/TANGENT.
          // Three.js doesn't support TANGENT yet.

          if (attributeName !== 'position' && attributeName !== 'normal') {

            if (!warned) {

              console.warn('GLTFExporter: Only POSITION and NORMAL morph are supported.');
              warned = true;

            }

            continue;

          }

          const attribute = geometry.morphAttributes[attributeName][i];
          const gltfAttributeName = attributeName.toUpperCase();

          // Three.js morph attribute has absolute values while the one of glTF has relative values.
          //
          // glTF 2.0 Specification:
          // https://github.com/KhronosGroup/glTF/tree/master/specification/2.0#morph-targets

          const baseAttribute = geometry.attributes[attributeName];

          if (cache.attributes.has(this.getUID(attribute))) {

            target[gltfAttributeName] = cache.attributes.get(this.getUID(attribute));
            continue;

          }

          // Clones attribute not to override
          const relativeAttribute = attribute.clone();

          if (!geometry.morphTargetsRelative) {

            for (let j = 0, jl = attribute.count; j < jl; j++) {

              relativeAttribute.setXYZ(
                j,
                attribute.getX(j) - baseAttribute.getX(j),
                attribute.getY(j) - baseAttribute.getY(j),
                attribute.getZ(j) - baseAttribute.getZ(j)
              );

            }

          }

          target[gltfAttributeName] = this.processAccessor(relativeAttribute, geometry);
          cache.attributes.set(this.getUID(baseAttribute), target[gltfAttributeName]);

        }

        targets.push(target);

        weights.push(mesh.morphTargetInfluences[i]);

        if (mesh.morphTargetDictionary !== undefined) targetNames.push(reverseDictionary[i]);

      }

      meshDef.weights = weights;

      if (targetNames.length > 0) {

        meshDef.extras = {};
        meshDef.extras.targetNames = targetNames;

      }

    }

    const isMultiMaterial = Array.isArray(mesh.material);

    if (isMultiMaterial && geometry.groups.length === 0) return null;

    const materials = isMultiMaterial ? mesh.material : [mesh.material];
    const groups = isMultiMaterial ? geometry.groups : [{
      materialIndex: 0,
      start: undefined,
      count: undefined
    }];

    for (let i = 0, il = groups.length; i < il; i++) {

      const primitive = {
        mode: mode,
        attributes: attributes,
      };

      this.serializeUserData(geometry, primitive);

      if (targets.length > 0)
        primitive.targets = targets;

      if (geometry.index !== null) {

        let cacheKey = this.getUID(geometry.index);

        if (groups[i].start !== undefined || groups[i].count !== undefined) {

          cacheKey += ':' + groups[i].start + ':' + groups[i].count;

        }

        if (cache.attributes.has(cacheKey)) {

          primitive.indices = cache.attributes.get(cacheKey);

        } else {

          primitive.indices = this.processAccessor(geometry.index, geometry, groups[i].start, groups[i].count);
          cache.attributes.set(cacheKey, primitive.indices);

        }

        if (primitive.indices === null)
          delete primitive.indices;

      }

      const material = this.processMaterial(materials[groups[i].materialIndex]);

      if (material !== null)
        primitive.material = material;

      primitives.push(primitive);

    }

    meshDef.primitives = primitives;

    if (!json.meshes)
      json.meshes = [];

    this._invokeAll(function(ext) {

      ext.writeMesh && ext.writeMesh(mesh, meshDef);

    });

    const index = json.meshes.push(meshDef) - 1;
    cache.meshes.set(meshCacheKey, index);
    return index;

  }

  /**
   * Process camera
   * @param  {THREE.Camera} camera Camera to process
   * @return {Integer}      Index of the processed mesh in the "camera" array
   */

  processCamera(camera) {

    const json = this.json;

    if (!json.cameras)
      json.cameras = [];

    const isOrtho = camera.isOrthographicCamera;

    const cameraDef = {
      type: isOrtho ? 'orthographic' : 'perspective'
    };

    if (isOrtho) {

      cameraDef.orthographic = {
        xmag: camera.right * 2,
        ymag: camera.top * 2,
        zfar: camera.far <= 0 ? 0.001 : camera.far,
        znear: camera.near < 0 ? 0 : camera.near
      };

    } else {

      cameraDef.perspective = {
        aspectRatio: camera.aspect,
        yfov: MathUtils.degToRad(camera.fov),
        zfar: camera.far <= 0 ? 0.001 : camera.far,
        znear: camera.near < 0 ? 0 : camera.near
      };

    }

    // Question: Is saving "type" as name intentional?
    if (camera.name !== '')
      cameraDef.name = camera.type;

    return json.cameras.push(cameraDef) - 1;

  }

  /**
   * Creates glTF animation entry from AnimationClip object.
   *
   * Status:
   * - Only properties listed in PATH_PROPERTIES may be animated.
   *
   * @param {THREE.AnimationClip} clip
   * @param {THREE.Object3D} root
   * @return {number|null}
   */

  processAnimation(clip, root) {

    const json = this.json;
    const nodeMap = this.nodeMap;

    if (!json.animations)
      json.animations = [];

    clip = GLTFExporter.Utils.mergeMorphTargetTracks(clip.clone(), root);

    const tracks = clip.tracks;
    const channels = [];
    const samplers = [];

    for (let i = 0; i < tracks.length; ++i) {

      const track = tracks[i];
      const trackBinding = PropertyBinding.parseTrackName(track.name);
      let trackNode = PropertyBinding.findNode(root, trackBinding.nodeName);
      const trackProperty = PATH_PROPERTIES[trackBinding.propertyName];

      if (trackBinding.objectName === 'bones') {

        if (trackNode.isSkinnedMesh === true) {

          trackNode = trackNode.skeleton.getBoneByName(trackBinding.objectIndex);

        } else {

          trackNode = undefined;

        }

      }

      if (!trackNode || !trackProperty) {

        console.warn('THREE.GLTFExporter: Could not export animation track "%s".', track.name);
        return null;

      }

      const inputItemSize = 1;
      let outputItemSize = track.values.length / track.times.length;

      if (trackProperty === PATH_PROPERTIES.morphTargetInfluences) {

        outputItemSize /= trackNode.morphTargetInfluences.length;

      }

      let interpolation;

      // @TODO export CubicInterpolant(InterpolateSmooth) as CUBICSPLINE

      // Detecting glTF cubic spline interpolant by checking factory method's special property
      // GLTFCubicSplineInterpolant is a custom interpolant and track doesn't return
      // valid value from .getInterpolation().
      if (track.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline === true) {

        interpolation = 'CUBICSPLINE';

        // itemSize of CUBICSPLINE keyframe is 9
        // (VEC3 * 3: inTangent, splineVertex, and outTangent)
        // but needs to be stored as VEC3 so dividing by 3 here.
        outputItemSize /= 3;

      } else if (track.getInterpolation() === InterpolateDiscrete) {

        interpolation = 'STEP';

      } else {

        interpolation = 'LINEAR';

      }

      samplers.push({
        input: this.processAccessor(new BufferAttribute$1(track.times, inputItemSize)),
        output: this.processAccessor(new BufferAttribute$1(track.values, outputItemSize)),
        interpolation: interpolation
      });

      channels.push({
        sampler: samplers.length - 1,
        target: {
          node: nodeMap.get(trackNode),
          path: trackProperty
        }
      });

    }

    json.animations.push({
      name: clip.name || 'clip_' + json.animations.length,
      samplers: samplers,
      channels: channels
    });

    return json.animations.length - 1;

  }

  /**
   * @param {THREE.Object3D} object
   * @return {number|null}
   */

  processSkin(object) {

    const json = this.json;
    const nodeMap = this.nodeMap;

    const node = json.nodes[nodeMap.get(object)];

    const skeleton = object.skeleton;

    if (skeleton === undefined) return null;

    const rootJoint = object.skeleton.bones[0];

    if (rootJoint === undefined) return null;

    const joints = [];
    const inverseBindMatrices = new Float32Array(skeleton.bones.length * 16);
    const temporaryBoneInverse = new Matrix4();

    for (let i = 0; i < skeleton.bones.length; ++i) {

      joints.push(nodeMap.get(skeleton.bones[i]));
      temporaryBoneInverse.copy(skeleton.boneInverses[i]);
      temporaryBoneInverse.multiply(object.bindMatrix).toArray(inverseBindMatrices, i * 16);

    }

    if (json.skins === undefined)
      json.skins = [];

    json.skins.push({
      inverseBindMatrices: this.processAccessor(new BufferAttribute$1(inverseBindMatrices, 16)),
      joints: joints,
      skeleton: nodeMap.get(rootJoint)
    });

    const skinIndex = node.skin = json.skins.length - 1;

    return skinIndex;

  }

  /**
   * Process Object3D node
   * @param  {THREE.Object3D} node Object3D to processNode
   * @return {Integer} Index of the node in the nodes list
   */

  processNode(object) {

    const json = this.json;
    const options = this.options;
    const nodeMap = this.nodeMap;

    if (!json.nodes)
      json.nodes = [];

    const nodeDef = {};

    if (options.trs) {

      const rotation = object.quaternion.toArray();
      const position = object.position.toArray();
      const scale = object.scale.toArray();

      if (!equalArray(rotation, [0, 0, 0, 1])) {

        nodeDef.rotation = rotation;

      }

      if (!equalArray(position, [0, 0, 0])) {

        nodeDef.translation = position;

      }

      if (!equalArray(scale, [1, 1, 1])) {

        nodeDef.scale = scale;

      }

    } else {

      if (object.matrixAutoUpdate) {

        object.updateMatrix();

      }

      if (isIdentityMatrix(object.matrix) === false) {

        nodeDef.matrix = object.matrix.elements;

      }

    }

    // We don't export empty strings name because it represents no-name in Three.js.
    if (object.name !== '')
      nodeDef.name = String(object.name);

    this.serializeUserData(object, nodeDef);

    if (object.isMesh || object.isLine || object.isPoints) {

      const meshIndex = this.processMesh(object);

      if (meshIndex !== null)
        nodeDef.mesh = meshIndex;

    } else if (object.isCamera) {

      nodeDef.camera = this.processCamera(object);

    }

    if (object.isSkinnedMesh) this.skins.push(object);

    if (object.children.length > 0) {

      const children = [];

      for (let i = 0, l = object.children.length; i < l; i++) {

        const child = object.children[i];

        if (child.visible || options.onlyVisible === false) {

          const nodeIndex = this.processNode(child);

          if (nodeIndex !== null) children.push(nodeIndex);

        }

      }

      if (children.length > 0)
        nodeDef.children = children;

    }

    this._invokeAll(function(ext) {

      ext.writeNode && ext.writeNode(object, nodeDef);

    });

    const nodeIndex = json.nodes.push(nodeDef) - 1;
    nodeMap.set(object, nodeIndex);
    return nodeIndex;

  }

  /**
   * Process Scene
   * @param  {Scene} node Scene to process
   */

  processScene(scene) {

    const json = this.json;
    const options = this.options;

    if (!json.scenes) {

      json.scenes = [];
      json.scene = 0;

    }

    const sceneDef = {};

    if (scene.name !== '')
      sceneDef.name = scene.name;

    json.scenes.push(sceneDef);

    const nodes = [];

    for (let i = 0, l = scene.children.length; i < l; i++) {

      const child = scene.children[i];

      if (child.visible || options.onlyVisible === false) {

        const nodeIndex = this.processNode(child);

        if (nodeIndex !== null) nodes.push(nodeIndex);

      }

    }

    if (nodes.length > 0)
      sceneDef.nodes = nodes;

    this.serializeUserData(scene, sceneDef);

  }

  /**
   * Creates a Scene to hold a list of objects and parse it
   * @param  {Array} objects List of objects to process
   */

  processObjects(objects) {

    const scene = new Scene();
    scene.name = 'AuxScene';

    for (let i = 0; i < objects.length; i++) {

      // We push directly to children instead of calling `add` to prevent
      // modify the .parent and break its original scene and hierarchy
      scene.children.push(objects[i]);

    }

    this.processScene(scene);

  }

  /**
   * @param {THREE.Object3D|Array<THREE.Object3D>} input
   */

  processInput(input) {

    const options = this.options;

    input = input instanceof Array ? input : [input];

    this._invokeAll(function(ext) {

      ext.beforeParse && ext.beforeParse(input);

    });

    const objectsWithoutScene = [];

    for (let i = 0; i < input.length; i++) {

      if (input[i] instanceof Scene) {

        this.processScene(input[i]);

      } else {

        objectsWithoutScene.push(input[i]);

      }

    }

    if (objectsWithoutScene.length > 0) this.processObjects(objectsWithoutScene);

    for (let i = 0; i < this.skins.length; ++i) {

      this.processSkin(this.skins[i]);

    }

    for (let i = 0; i < options.animations.length; ++i) {

      this.processAnimation(options.animations[i], input[0]);

    }

    this._invokeAll(function(ext) {

      ext.afterParse && ext.afterParse(input);

    });

  }

  _invokeAll(func) {

    for (let i = 0, il = this.plugins.length; i < il; i++) {

      func(this.plugins[i]);

    }

  }

}

/**
 * Punctual Lights Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_lights_punctual
 */

class GLTFLightExtension {

  constructor(writer) {

    this.writer = writer;
    this.name = 'KHR_lights_punctual';

  }

  writeNode(light, nodeDef) {

    if (!light.isLight) return;

    if (!light.isDirectionalLight && !light.isPointLight && !light.isSpotLight) {

      console.warn('THREE.GLTFExporter: Only directional, point, and spot lights are supported.', light);
      return;

    }

    const writer = this.writer;
    const json = writer.json;
    const extensionsUsed = writer.extensionsUsed;

    const lightDef = {};

    if (light.name)
      lightDef.name = light.name;

    lightDef.color = light.color.toArray();

    lightDef.intensity = light.intensity;

    if (light.isDirectionalLight) {

      lightDef.type = 'directional';

    } else if (light.isPointLight) {

      lightDef.type = 'point';

      if (light.distance > 0)
        lightDef.range = light.distance;

    } else if (light.isSpotLight) {

      lightDef.type = 'spot';

      if (light.distance > 0)
        lightDef.range = light.distance;

      lightDef.spot = {};
      lightDef.spot.innerConeAngle = (light.penumbra - 1.0) * light.angle * -1.0;
      lightDef.spot.outerConeAngle = light.angle;

    }

    if (light.decay !== undefined && light.decay !== 2) {

      console.warn('THREE.GLTFExporter: Light decay may be lost. glTF is physically-based, '
        + 'and expects light.decay=2.');

    }

    if (light.target
      && (light.target.parent !== light
      || light.target.position.x !== 0
      || light.target.position.y !== 0
      || light.target.position.z !== -1)) {

      console.warn('THREE.GLTFExporter: Light direction may be lost. For best results, '
        + 'make light.target a child of the light with position 0,0,-1.');

    }

    if (!extensionsUsed[this.name]) {

      json.extensions = json.extensions || {};
      json.extensions[this.name] = {
        lights: []
      };
      extensionsUsed[this.name] = true;

    }

    const lights = json.extensions[this.name].lights;
    lights.push(lightDef);

    nodeDef.extensions = nodeDef.extensions || {};
    nodeDef.extensions[this.name] = {
      light: lights.length - 1
    };

  }

}

/**
 * Unlit Materials Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_unlit
 */

class GLTFMaterialsUnlitExtension {

  constructor(writer) {

    this.writer = writer;
    this.name = 'KHR_materials_unlit';

  }

  writeMaterial(material, materialDef) {

    if (!material.isMeshBasicMaterial) return;

    const writer = this.writer;
    const extensionsUsed = writer.extensionsUsed;

    materialDef.extensions = materialDef.extensions || {};
    materialDef.extensions[this.name] = {};

    extensionsUsed[this.name] = true;

    materialDef.pbrMetallicRoughness.metallicFactor = 0.0;
    materialDef.pbrMetallicRoughness.roughnessFactor = 0.9;

  }

}

/**
 * Specular-Glossiness Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_pbrSpecularGlossiness
 */

class GLTFMaterialsPBRSpecularGlossiness {

  constructor(writer) {

    this.writer = writer;
    this.name = 'KHR_materials_pbrSpecularGlossiness';

  }

  writeMaterial(material, materialDef) {

    if (!material.isGLTFSpecularGlossinessMaterial) return;

    const writer = this.writer;
    const extensionsUsed = writer.extensionsUsed;

    const extensionDef = {};

    if (materialDef.pbrMetallicRoughness.baseColorFactor) {

      extensionDef.diffuseFactor = materialDef.pbrMetallicRoughness.baseColorFactor;

    }

    const specularFactor = [1, 1, 1];
    material.specular.toArray(specularFactor, 0);
    extensionDef.specularFactor = specularFactor;
    extensionDef.glossinessFactor = material.glossiness;

    if (materialDef.pbrMetallicRoughness.baseColorTexture) {

      extensionDef.diffuseTexture = materialDef.pbrMetallicRoughness.baseColorTexture;

    }

    if (material.specularMap) {

      const specularMapDef = {
        index: writer.processTexture(material.specularMap)
      };
      writer.applyTextureTransform(specularMapDef, material.specularMap);
      extensionDef.specularGlossinessTexture = specularMapDef;

    }

    materialDef.extensions = materialDef.extensions || {};
    materialDef.extensions[this.name] = extensionDef;
    extensionsUsed[this.name] = true;

  }

}

/**
 * Clearcoat Materials Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_clearcoat
 */

class GLTFMaterialsClearcoatExtension {

  constructor(writer) {

    this.writer = writer;
    this.name = 'KHR_materials_clearcoat';

  }

  writeMaterial(material, materialDef) {

    if (!material.isMeshPhysicalMaterial) return;

    const writer = this.writer;
    const extensionsUsed = writer.extensionsUsed;

    const extensionDef = {};

    extensionDef.clearcoatFactor = material.clearcoat;

    if (material.clearcoatMap) {

      const clearcoatMapDef = {
        index: writer.processTexture(material.clearcoatMap)
      };
      writer.applyTextureTransform(clearcoatMapDef, material.clearcoatMap);
      extensionDef.clearcoatTexture = clearcoatMapDef;

    }

    extensionDef.clearcoatRoughnessFactor = material.clearcoatRoughness;

    if (material.clearcoatRoughnessMap) {

      const clearcoatRoughnessMapDef = {
        index: writer.processTexture(material.clearcoatRoughnessMap)
      };
      writer.applyTextureTransform(clearcoatRoughnessMapDef, material.clearcoatRoughnessMap);
      extensionDef.clearcoatRoughnessTexture = clearcoatRoughnessMapDef;

    }

    if (material.clearcoatNormalMap) {

      const clearcoatNormalMapDef = {
        index: writer.processTexture(material.clearcoatNormalMap)
      };
      writer.applyTextureTransform(clearcoatNormalMapDef, material.clearcoatNormalMap);
      extensionDef.clearcoatNormalTexture = clearcoatNormalMapDef;

    }

    materialDef.extensions = materialDef.extensions || {};
    materialDef.extensions[this.name] = extensionDef;

    extensionsUsed[this.name] = true;


  }

}

/**
 * Transmission Materials Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_transmission
 */

class GLTFMaterialsTransmissionExtension {

  constructor(writer) {

    this.writer = writer;
    this.name = 'KHR_materials_transmission';

  }

  writeMaterial(material, materialDef) {

    if (!material.isMeshPhysicalMaterial || material.transmission === 0) return;

    const writer = this.writer;
    const extensionsUsed = writer.extensionsUsed;

    const extensionDef = {};

    extensionDef.transmissionFactor = material.transmission;

    if (material.transmissionMap) {

      const transmissionMapDef = {
        index: writer.processTexture(material.transmissionMap)
      };
      writer.applyTextureTransform(transmissionMapDef, material.transmissionMap);
      extensionDef.transmissionTexture = transmissionMapDef;

    }

    materialDef.extensions = materialDef.extensions || {};
    materialDef.extensions[this.name] = extensionDef;

    extensionsUsed[this.name] = true;

  }

}

/**
 * Materials Volume Extension
 *
 * Specification: https://github.com/KhronosGroup/glTF/tree/master/extensions/2.0/Khronos/KHR_materials_volume
 */

class GLTFMaterialsVolumeExtension {

  constructor(writer) {

    this.writer = writer;
    this.name = 'KHR_materials_volume';

  }

  writeMaterial(material, materialDef) {

    if (!material.isMeshPhysicalMaterial || material.transmission === 0) return;

    const writer = this.writer;
    const extensionsUsed = writer.extensionsUsed;

    const extensionDef = {};

    extensionDef.thicknessFactor = material.thickness;

    if (material.thicknessMap) {

      const thicknessMapDef = {
        index: writer.processTexture(material.thicknessMap)
      };
      writer.applyTextureTransform(thicknessMapDef, material.thicknessMap);
      extensionDef.thicknessTexture = thicknessMapDef;

    }

    extensionDef.attenuationDistance = material.attenuationDistance;
    extensionDef.attenuationColor = material.attenuationColor.toArray();

    materialDef.extensions = materialDef.extensions || {};
    materialDef.extensions[this.name] = extensionDef;

    extensionsUsed[this.name] = true;

  }

}

/**
 * Static utility functions
 */
GLTFExporter.Utils = {

  insertKeyframe: function(track, time) {

    const tolerance = 0.001; // 1ms
    const valueSize = track.getValueSize();

    const times = new track.TimeBufferType(track.times.length + 1);
    const values = new track.ValueBufferType(track.values.length + valueSize);
    const interpolant = track.createInterpolant(new track.ValueBufferType(valueSize));

    let index;

    if (track.times.length === 0) {

      times[0] = time;

      for (let i = 0; i < valueSize; i++) {

        values[i] = 0;

      }

      index = 0;

    } else if (time < track.times[0]) {

      if (Math.abs(track.times[0] - time) < tolerance) return 0;

      times[0] = time;
      times.set(track.times, 1);

      values.set(interpolant.evaluate(time), 0);
      values.set(track.values, valueSize);

      index = 0;

    } else if (time > track.times[track.times.length - 1]) {

      if (Math.abs(track.times[track.times.length - 1] - time) < tolerance) {

        return track.times.length - 1;

      }

      times[times.length - 1] = time;
      times.set(track.times, 0);

      values.set(track.values, 0);
      values.set(interpolant.evaluate(time), track.values.length);

      index = times.length - 1;

    } else {

      for (let i = 0; i < track.times.length; i++) {

        if (Math.abs(track.times[i] - time) < tolerance) return i;

        if (track.times[i] < time && track.times[i + 1] > time) {

          times.set(track.times.slice(0, i + 1), 0);
          times[i + 1] = time;
          times.set(track.times.slice(i + 1), i + 2);

          values.set(track.values.slice(0, (i + 1) * valueSize), 0);
          values.set(interpolant.evaluate(time), (i + 1) * valueSize);
          values.set(track.values.slice((i + 1) * valueSize), (i + 2) * valueSize);

          index = i + 1;

          break;

        }

      }

    }

    track.times = times;
    track.values = values;

    return index;

  },

  mergeMorphTargetTracks: function(clip, root) {

    const tracks = [];
    const mergedTracks = {};
    const sourceTracks = clip.tracks;

    for (let i = 0; i < sourceTracks.length; ++i) {

      let sourceTrack = sourceTracks[i];
      const sourceTrackBinding = PropertyBinding.parseTrackName(sourceTrack.name);
      const sourceTrackNode = PropertyBinding.findNode(root, sourceTrackBinding.nodeName);

      if (sourceTrackBinding.propertyName !== 'morphTargetInfluences' || sourceTrackBinding.propertyIndex === undefined) {

        // Tracks that don't affect morph targets, or that affect all morph targets together, can be left as-is.
        tracks.push(sourceTrack);
        continue;

      }

      if (sourceTrack.createInterpolant !== sourceTrack.InterpolantFactoryMethodDiscrete
        && sourceTrack.createInterpolant !== sourceTrack.InterpolantFactoryMethodLinear) {

        if (sourceTrack.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline) {

          // This should never happen, because glTF morph target animations
          // affect all targets already.
          throw new Error('THREE.GLTFExporter: Cannot merge tracks with glTF CUBICSPLINE interpolation.');

        }

        console.warn('THREE.GLTFExporter: Morph target interpolation mode not yet supported. Using LINEAR instead.');

        sourceTrack = sourceTrack.clone();
        sourceTrack.setInterpolation(InterpolateLinear);

      }

      const targetCount = sourceTrackNode.morphTargetInfluences.length;
      const targetIndex = sourceTrackNode.morphTargetDictionary[sourceTrackBinding.propertyIndex];

      if (targetIndex === undefined) {

        throw new Error('THREE.GLTFExporter: Morph target name not found: ' + sourceTrackBinding.propertyIndex);

      }

      let mergedTrack;

      // If this is the first time we've seen this object, create a new
      // track to store merged keyframe data for each morph target.
      if (mergedTracks[sourceTrackNode.uuid] === undefined) {

        mergedTrack = sourceTrack.clone();

        const values = new mergedTrack.ValueBufferType(targetCount * mergedTrack.times.length);

        for (let j = 0; j < mergedTrack.times.length; j++) {

          values[j * targetCount + targetIndex] = mergedTrack.values[j];

        }

        // We need to take into consideration the intended target node
        // of our original un-merged morphTarget animation.
        mergedTrack.name = (sourceTrackBinding.nodeName || '') + '.morphTargetInfluences';
        mergedTrack.values = values;

        mergedTracks[sourceTrackNode.uuid] = mergedTrack;
        tracks.push(mergedTrack);

        continue;

      }

      const sourceInterpolant = sourceTrack.createInterpolant(new sourceTrack.ValueBufferType(1));

      mergedTrack = mergedTracks[sourceTrackNode.uuid];

      // For every existing keyframe of the merged track, write a (possibly
      // interpolated) value from the source track.
      for (let j = 0; j < mergedTrack.times.length; j++) {

        mergedTrack.values[j * targetCount + targetIndex] = sourceInterpolant.evaluate(mergedTrack.times[j]);

      }

      // For every existing keyframe of the source track, write a (possibly
      // new) keyframe to the merged track. Values from the previous loop may
      // be written again, but keyframes are de-duplicated.
      for (let j = 0; j < sourceTrack.times.length; j++) {

        const keyframeIndex = this.insertKeyframe(mergedTrack, sourceTrack.times[j]);
        mergedTrack.values[keyframeIndex * targetCount + targetIndex] = sourceTrack.values[j];

      }

    }

    clip.tracks = tracks;

    return clip;

  }

};

class FragmentMesh extends InstancedMesh {

  constructor(geometry, material, count) {
    super(geometry, material, count);
    this.elementCount = 0;
    this.exportOptions = {
      trs: false,
      onlyVisible: false,
      truncateDrawRange: true,
      binary: true,
      maxTextureSize: 0
    };
    this.exporter = new GLTFExporter();
    this.material = FragmentMesh.newMaterialArray(material);
    this.geometry = this.newFragmentGeometry(geometry);
  }

  export() {
    const mesh = this;
    return new Promise((resolve) => {
      this.exporter.parse(mesh, (geometry) => resolve(geometry), this.exportOptions);
    });
  }

  newFragmentGeometry(geometry) {
    if (!geometry.index) {
      throw new Error('The geometry must be indexed!');
    }
    if (!geometry.attributes.blockID) {
      const vertexSize = geometry.attributes.position.count;
      const array = new Uint16Array(vertexSize);
      array.fill(this.elementCount++);
      geometry.attributes.blockID = new BufferAttribute(array, 1);
    }
    const size = geometry.index.count;
    FragmentMesh.initializeGroups(geometry, size);
    return geometry;
  }

  static initializeGroups(geometry, size) {
    if (!geometry.groups.length) {
      geometry.groups.push({
        start: 0,
        count: size,
        materialIndex: 0
      });
    }
  }

  static newMaterialArray(material) {
    if (!Array.isArray(material))
      material = [material];
    return material;
  }

}

class BlocksMap {

  constructor(fragment) {
    this.indices = BlocksMap.initializeBlocks(fragment);
    this.generateGeometryIndexMap(fragment);
  }

  generateGeometryIndexMap(fragment) {
    const geometry = fragment.mesh.geometry;
    for (const group of geometry.groups) {
      this.fillBlocksMapWithGroupInfo(group, geometry);
    }
  }

  getSubsetID(modelID, material, customID = 'DEFAULT') {
    const baseID = modelID;
    const materialID = material ? material.uuid : 'DEFAULT';
    return `${baseID} - ${materialID} - ${customID}`;
  }

  // Use this only for destroying the current IFCLoader instance

  dispose() {
    this.indices = null;
  }

  static initializeBlocks(fragment) {
    const geometry = fragment.mesh.geometry;
    const startIndices = geometry.index.array;
    return {
      indexCache: startIndices.slice(0, geometry.index.array.length),
      map: new Map()
    };
  }

  fillBlocksMapWithGroupInfo(group, geometry) {
    let prevBlockID = -1;
    const materialIndex = group.materialIndex;
    const materialStart = group.start;
    const materialEnd = materialStart + group.count - 1;
    let objectStart = -1;
    let objectEnd = -1;
    for (let i = materialStart; i <= materialEnd; i++) {
      const index = geometry.index.array[i];
      const blockID = geometry.attributes.blockID.array[index];
      // First iteration
      if (prevBlockID === -1) {
        prevBlockID = blockID;
        objectStart = i;
      }
      // It's the end of the material, which also means end of the object
      const isEndOfMaterial = i === materialEnd;
      if (isEndOfMaterial) {
        const store = this.getMaterialStore(blockID, materialIndex);
        store.push(objectStart, materialEnd);
        break;
      }
      // Still going through the same object
      if (prevBlockID === blockID)
        continue;
      // New object starts; save previous object
      // Store previous object
      const store = this.getMaterialStore(prevBlockID, materialIndex);
      objectEnd = i - 1;
      store.push(objectStart, objectEnd);
      // Get ready to process next object
      prevBlockID = blockID;
      objectStart = i;
    }
  }

  getMaterialStore(id, matIndex) {
    // If this object wasn't store before, add it to the map
    if (this.indices.map.get(id) === undefined) {
      this.indices.map.set(id, {});
    }
    const storedIfcItem = this.indices.map.get(id);
    if (storedIfcItem === undefined)
      throw new Error('Geometry map generation error');
    // If this material wasn't stored for this object before, add it to the object
    if (storedIfcItem[matIndex] === undefined) {
      storedIfcItem[matIndex] = [];
    }
    return storedIfcItem[matIndex];
  }

}

/**
 * Contains the logic to get, create and delete geometric subsets of an IFC model. For example,
 * this can extract all the items in a specific IfcBuildingStorey and create a new Mesh.
 */

class Blocks {

  constructor(fragment) {
    this.fragment = fragment;
    this.tempIndex = [];
    this.blocksMap = new BlocksMap(fragment);
    this.initializeSubsetGroups(fragment);
    const rawIds = fragment.mesh.geometry.attributes.blockID.array;
    this.visibleIds = new Set(rawIds);
    this.ids = new Set(rawIds);
    this.add(Array.from(this.ids), true);
  }

  get count() {
    return this.ids.size;
  }

  reset() {
    this.add(Array.from(this.ids), true);
  }

  add(ids, removePrevious = true) {
    this.filterIndices(removePrevious);
    const filtered = ids.filter((id) => !this.visibleIds.has(id));
    this.constructSubsetByMaterial(ids);
    filtered.forEach((id) => this.visibleIds.add(id));
    this.fragment.mesh.geometry.setIndex(this.tempIndex);
    this.tempIndex.length = 0;
  }

  remove(ids) {
    ids.forEach((id) => this.visibleIds.has(id) && this.visibleIds.delete(id));
    const remainingIDs = Array.from(this.visibleIds);
    this.add(remainingIDs, true);
  }

  // Use this only for destroying the current Fragment instance

  dispose() {
    this.blocksMap.dispose();
    this.tempIndex = [];
    this.visibleIds.clear();
    this.visibleIds = null;
    this.ids.clear();
    this.ids = null;
  }

  initializeSubsetGroups(fragment) {
    const geometry = fragment.mesh.geometry;
    geometry.groups = JSON.parse(JSON.stringify(geometry.groups));
    this.resetGroups(geometry);
  }

  // Remove previous indices or filter the given ones to avoid repeating items

  filterIndices(removePrevious) {
    const geometry = this.fragment.mesh.geometry;
    if (!removePrevious) {
      this.tempIndex = Array.from(geometry.index.array);
      return;
    }
    geometry.setIndex([]);
    this.resetGroups(geometry);
  }

  constructSubsetByMaterial(ids) {
    const length = this.fragment.mesh.geometry.groups.length;
    const newIndices = {
      count: 0
    };
    for (let i = 0; i < length; i++) {
      this.insertNewIndices(ids, i, newIndices);
    }
  }

  // Inserts indices in correct position and update groups

  insertNewIndices(ids, materialIndex, newIndices) {
    const indicesOfOneMaterial = this.getAllIndicesOfGroup(ids, materialIndex);
    this.insertIndicesAtGroup(indicesOfOneMaterial, materialIndex, newIndices);
  }

  insertIndicesAtGroup(indicesByGroup, index, newIndices) {
    const currentGroup = this.getCurrentGroup(index);
    currentGroup.start += newIndices.count;
    const newIndicesPosition = currentGroup.start + currentGroup.count;
    newIndices.count += indicesByGroup.length;
    if (indicesByGroup.length > 0) {
      const position = newIndicesPosition;
      const start = this.tempIndex.slice(0, position);
      const end = this.tempIndex.slice(position);
      this.tempIndex = Array.prototype.concat.apply([], [start, indicesByGroup, end]);
      currentGroup.count += indicesByGroup.length;
    }
  }

  getCurrentGroup(groupIndex) {
    return this.fragment.mesh.geometry.groups[groupIndex];
  }

  resetGroups(geometry) {
    geometry.groups.forEach((group) => {
      group.start = 0;
      group.count = 0;
    });
  }

  // If flatten, all indices are in the same array; otherwise, indices are split in subarrays by material

  getAllIndicesOfGroup(ids, materialIndex, flatten = true) {
    const indicesByGroup = [];
    for (const id of ids) {
      const entry = this.blocksMap.indices.map.get(id);
      if (!entry)
        continue;
      const value = entry[materialIndex];
      if (!value)
        continue;
      this.getIndexChunk(value, indicesByGroup, materialIndex, flatten);
    }
    return indicesByGroup;
  }

  getIndexChunk(value, indicesByGroup, materialIndex, flatten) {
    const pairs = value.length / 2;
    for (let pair = 0; pair < pairs; pair++) {
      const pairIndex = pair * 2;
      const start = value[pairIndex];
      const end = value[pairIndex + 1];
      for (let j = start; j <= end; j++) {
        if (flatten)
          indicesByGroup.push(this.blocksMap.indices.indexCache[j]);
        else {
          if (!indicesByGroup[materialIndex])
            indicesByGroup[materialIndex] = [];
          indicesByGroup[materialIndex].push(this.blocksMap.indices.indexCache[j]);
        }
      }
    }
  }

}

// Source: https://github.com/gkjohnson/three-mesh-bvh

class BVH {

  static apply(geometry) {
    if (!BVH.initialized) {
      BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
      BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
      Mesh.prototype.raycast = acceleratedRaycast;
      BVH.initialized = true;
    }
    if (!geometry.boundsTree) {
      geometry.computeBoundsTree();
    }
  }

  static dispose(geometry) {
    geometry.disposeBoundsTree();
  }

}

BVH.initialized = false;

/*
 * Fragments can contain one or multiple Instances of one or multiple Blocks
 * Each Instance is identified by an instanceID (property of THREE.InstancedMesh)
 * Each Block identified by a blockID (custom bufferAttribute per vertex)
 * Both instanceId and blockId are unsigned integers starting at 0 and going up sequentially
 * A specific Block of a specific Instance is an Item, identified by an itemID
 *
 * For example:
 * Imagine a fragment mesh with 8 instances and 2 elements (16 items, identified from A to P)
 * It will have instanceIds from 0 to 8, and blockIds from 0 to 2
 * If we raycast it, we will get an instanceId and the index of the found triangle
 * We can use the index to get the blockId for that triangle
 * Combining instanceId and blockId using the elementMap will give us the itemId
 * The items will look like this:
 *
 *    [ A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, P ]
 *
 *  Where the criteria to sort the items is the following (Y-axis is instance, X-axis is block):
 *
 *        A  C  E  G  I  K  M  O
 *        B  D  F  H  J  L  N  P
 * */

class Fragment {

  constructor(geometry, material, count) {
    this.fragments = {};
    this.items = [];
    this.hiddenInstances = {};
    this.mesh = new FragmentMesh(geometry, material, count);
    this.id = this.mesh.uuid;
    this.capacity = count;
    this.blocks = new Blocks(this);
    BVH.apply(geometry);
  }

  dispose(disposeResources = true) {
    this.items = null;
    if (disposeResources) {
      this.mesh.material.forEach((mat) => mat.dispose());
      BVH.dispose(this.mesh.geometry);
      this.mesh.geometry.dispose();
    }
    this.mesh.dispose();
    this.mesh = null;
    this.disposeNestedFragments();
  }

  getItemID(instanceID, blockID) {
    const index = this.getItemIndex(instanceID, blockID);
    return this.items[index];
  }

  getInstanceAndBlockID(itemID) {
    const index = this.items.indexOf(itemID);
    const instanceID = this.getInstanceIDFromIndex(index);
    const blockID = index % this.blocks.count;
    return {
      instanceID,
      blockID
    };
  }

  getVertexBlockID(geometry, index) {
    return geometry.attributes.blockID.array[index];
  }

  getItemData(itemID) {
    const index = this.items.indexOf(itemID);
    const instanceID = Math.ceil(index / this.blocks.count);
    const blockID = index % this.blocks.count;
    return {
      instanceID,
      blockID
    };
  }

  getInstance(instanceID, matrix) {
    return this.mesh.getMatrixAt(instanceID, matrix);
  }

  setInstance(instanceID, items) {
    this.checkIfInstanceExist(instanceID);
    this.mesh.setMatrixAt(instanceID, items.transform);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (items.ids) {
      this.saveItemsInMap(items.ids, instanceID);
    }
  }

  addInstances(items) {
    this.resizeCapacityIfNeeded(items.length);
    const start = this.mesh.count;
    this.mesh.count += items.length;
    for (let i = 0; i < items.length; i++) {
      this.setInstance(start + i, items[i]);
    }
  }

  removeInstances(itemsIDs) {
    if (this.mesh.count <= 1) {
      this.clear();
      return;
    }
    this.deleteAndRearrangeInstances(itemsIDs);
    this.mesh.count -= itemsIDs.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.mesh.clear();
    this.mesh.count = 0;
    this.items = [];
  }

  addFragment(id, material = this.mesh.material) {
    const newGeometry = this.initializeGeometry();
    if (material === this.mesh.material) {
      this.copyGroups(newGeometry);
    }
    const newFragment = new Fragment(newGeometry, material, this.capacity);
    newFragment.mesh.applyMatrix4(this.mesh.matrix);
    newFragment.mesh.updateMatrix();
    this.fragments[id] = newFragment;
    return this.fragments[id];
  }

  removeFragment(id) {
    const fragment = this.fragments[id];
    if (fragment) {
      fragment.dispose(false);
      delete this.fragments[id];
    }
  }

  resetVisibility() {
    if (this.blocks.count > 1) {
      this.blocks.reset();
    } else {
      const hiddenInstances = Object.keys(this.hiddenInstances);
      this.makeInstancesVisible(hiddenInstances);
      this.hiddenInstances = {};
    }
  }

  setVisibility(itemIDs, visible) {
    if (this.blocks.count > 1) {
      this.toggleBlockVisibility(visible, itemIDs);
      this.mesh.geometry.disposeBoundsTree();
      BVH.apply(this.mesh.geometry);
    } else {
      this.toggleInstanceVisibility(visible, itemIDs);
    }
  }

  resize(size) {
    var _a;
    const newMesh = this.createFragmentMeshWithNewSize(size);
    this.capacity = size;
    const oldMesh = this.mesh;
    (_a = oldMesh.parent) === null || _a === void 0 ? void 0 : _a.add(newMesh);
    oldMesh.removeFromParent();
    this.mesh = newMesh;
    oldMesh.dispose();
  }

  async export() {
    const geometryBuffer = await this.mesh.export();
    const geometry = new File([new Blob([geometryBuffer])], `${this.id}.glb`);
    const fragmentData = {
      matrices: Array.from(this.mesh.instanceMatrix.array),
      ids: this.items
    };
    const dataString = JSON.stringify(fragmentData);
    const data = new File([new Blob([dataString])], `${this.id}.json`);
    return {
      geometry,
      data
    };
  }

  copyGroups(newGeometry) {
    newGeometry.groups = [];
    for (const group of this.mesh.geometry.groups) {
      newGeometry.groups.push({
        ...group
      });
    }
  }

  initializeGeometry() {
    const newGeometry = new BufferGeometry();
    newGeometry.setAttribute('position', this.mesh.geometry.attributes.position);
    newGeometry.setAttribute('normal', this.mesh.geometry.attributes.normal);
    newGeometry.setAttribute('blockID', this.mesh.geometry.attributes.blockID);
    newGeometry.setIndex(Array.from(this.mesh.geometry.index.array));
    return newGeometry;
  }

  saveItemsInMap(ids, instanceId) {
    this.checkBlockNumberValid(ids);
    let counter = 0;
    for (const id of ids) {
      const index = this.getItemIndex(instanceId, counter);
      this.items[index] = id;
      counter++;
    }
  }

  resizeCapacityIfNeeded(newSize) {
    const necessaryCapacity = newSize + this.mesh.count;
    if (necessaryCapacity > this.capacity) {
      this.resize(necessaryCapacity);
    }
  }

  createFragmentMeshWithNewSize(capacity) {
    const newMesh = new FragmentMesh(this.mesh.geometry, this.mesh.material, capacity);
    newMesh.count = this.mesh.count;
    return newMesh;
  }

  disposeNestedFragments() {
    const fragments = Object.values(this.fragments);
    for (let i = 0; i < fragments.length; i++) {
      fragments[i].dispose();
    }
    this.fragments = {};
  }

  checkBlockNumberValid(ids) {
    if (ids.length > this.blocks.count) {
      throw new Error(`You passed more items (${ids.length}) than blocks in this instance (${this.blocks.count})`);
    }
  }

  checkIfInstanceExist(index) {
    if (index > this.mesh.count) {
      throw new Error(`The given index (${index}) exceeds the instances in this fragment (${this.mesh.count})`);
    }
  }

  // Assigns the index of the removed instance to the last instance
  // F.e. let there be 6 instances: (A) (B) (C) (D) (E) (F)
  // If instance (C) is removed: -> (A) (B) (F) (D) (E)

  deleteAndRearrangeInstances(ids) {
    const deletedItems = [];
    for (const id of ids) {
      const deleted = this.deleteAndRearrange(id);
      if (deleted) {
        deletedItems.push(deleted);
      }
    }
    for (const id of ids) {
      delete this.hiddenInstances[id];
    }
    return deletedItems;
  }

  deleteAndRearrange(id) {
    const index = this.items.indexOf(id);
    if (index === -1)
      return null;
    this.mesh.count--;
    const isLastElement = index === this.mesh.count;
    const instanceId = this.getInstanceIDFromIndex(index);
    const tempMatrix = new Matrix4();
    const transform = new Matrix4();
    this.mesh.getMatrixAt(instanceId, transform);
    if (isLastElement) {
      this.items.pop();
      return {
        ids: [id],
        transform
      };
    }
    const lastElement = this.mesh.count;
    this.items[index] = this.items[lastElement];
    this.items.pop();
    this.mesh.getMatrixAt(lastElement, tempMatrix);
    this.mesh.setMatrixAt(instanceId, tempMatrix);
    this.mesh.instanceMatrix.needsUpdate = true;
    return {
      ids: [id],
      transform
    };
  }

  getItemIndex(instanceId, blockId) {
    return instanceId * this.blocks.count + blockId;
  }

  getInstanceIDFromIndex(itemIndex) {
    return Math.trunc(itemIndex / this.blocks.count);
  }

  toggleInstanceVisibility(visible, itemIDs) {
    if (visible) {
      this.makeInstancesVisible(itemIDs);
    } else {
      this.makeInstancesInvisible(itemIDs);
    }
  }

  makeInstancesInvisible(itemIDs) {
    itemIDs = this.filterHiddenItems(itemIDs, false);
    const deletedItems = this.deleteAndRearrangeInstances(itemIDs);
    for (const item of deletedItems) {
      if (item.ids) {
        this.hiddenInstances[item.ids[0]] = item;
      }
    }
  }

  makeInstancesVisible(itemIDs) {
    const items = [];
    itemIDs = this.filterHiddenItems(itemIDs, true);
    for (const id of itemIDs) {
      items.push(this.hiddenInstances[id]);
      delete this.hiddenInstances[id];
    }
    this.addInstances(items);
  }

  filterHiddenItems(itemIDs, hidden) {
    const hiddenItems = Object.keys(this.hiddenInstances);
    return itemIDs.filter((item) => hidden ? hiddenItems.includes(item) : !hiddenItems.includes(item));
  }

  toggleBlockVisibility(visible, itemIDs) {
    const blockIDs = itemIDs.map((id) => this.getInstanceAndBlockID(id).blockID);
    if (visible) {
      this.blocks.add(blockIDs, false);
    } else {
      this.blocks.remove(blockIDs);
    }
  }

}

class FragmentGroup extends IFCModel {

  constructor() {
    super(...arguments);
    this.fragments = [];
  }

}

class FragmentParser {

  constructor(state, properties, types, BVH) {
    this.state = state;
    this.properties = properties;
    this.types = types;
    this.BVH = BVH;
    this.instancedCategories = new Set();
    this.splitByFloors = true;
    this.splitByCategory = true;
    this.loadedModels = 0;
    this.optionalCategories = {
      [IFCSPACE]: true,
      [IFCOPENINGELEMENT]: false,
    };
    this.items = {};
    this.materials = {};
    this.loadingState = {
      total: 0,
      current: 0,
      step: 0.1,
    };
    this.currentWebIfcID = -1;
    this.currentModelID = -1;
  }

  async setupOptionalCategories(config) {
    this.optionalCategories = config;
  }

  async parse(buffer, coordinationMatrix) {
    if (this.state.api.wasmModule === undefined) {
      await this.state.api.Init();
    }
    await this.newIfcModel(buffer);
    this.loadedModels++;
    if (coordinationMatrix) {
      await this.state.api.SetGeometryTransformation(this.currentWebIfcID, coordinationMatrix);
    }
    return await this.loadAllGeometry(this.currentWebIfcID);
  }

  getAndClearErrors(_modelId) {}

  notifyProgress(loaded, total) {
    if (this.state.onProgress) {
      this.state.onProgress({
        loaded,
        total
      });
    }
  }

  async newIfcModel(buffer) {
    const data = new Uint8Array(buffer);
    this.currentWebIfcID = await this.state.api.OpenModel(data, this.state.webIfcSettings);
    this.currentModelID = this.state.useJSON ? this.loadedModels : this.currentWebIfcID;
    this.state.models[this.currentModelID] = {
      modelID: this.currentModelID,
      mesh: {},
      types: {},
      jsonData: {},
    };
  }

  async loadAllGeometry(modelID) {
    this.addOptionalCategories(modelID);
    await this.initializeLoadingState(modelID);
    this.instancedCategories.add(IFCFURNISHINGELEMENT);
    this.instancedCategories.add(IFCWINDOW);
    this.instancedCategories.add(IFCDOOR);
    this.state.api.StreamAllMeshes(modelID, (mesh) => {
      this.updateLoadingState();
      this.streamMesh(modelID, mesh);
    });
    if (this.splitByCategory && this.types) {
      await this.types.getAllTypes();
    }
    const floorProperties = [];
    let tree = {};
    if (this.splitByFloors && this.properties) {
      const project = await this.properties.getSpatialStructure(modelID);
      const floors = project.children[0].children[0].children;
      for (const floor of floors) {
        const props = await this.properties.getItemProperties(modelID, floor.expressID, false);
        floorProperties.push(props);
        for (const item of floor.children) {
          tree[item.expressID] = floor.expressID;
          if (item.children.length) {
            for (const child of item.children) {
              tree[child.expressID] = floor.expressID;
            }
          }
        }
      }
    }
    const model = new FragmentGroup();
    const fragmentsData = Object.values(this.items);
    const uniqueItems = {};
    for (const data of fragmentsData) {
      const size = data.instances.length;
      const id = data.instances[0].id;
      const typeNumber = this.state.models[0].types[id];
      const isUnique = size === 1;
      if (!isUnique || this.instancedCategories.has(typeNumber)) {
        const mats = Object.keys(data.geometriesByMaterial).map(id => this.materials[id]);
        const geoms = Object.values(data.geometriesByMaterial);
        const merged = GeometryUtils.merge(geoms);
        const fragment = new Fragment(merged, mats, size);
        for (let i = 0; i < size; i++) {
          const instance = data.instances[i];
          fragment.setInstance(i, {
            ids: [instance.id.toString()],
            transform: instance.matrix
          });
        }
        model.fragments.push(fragment);
        model.add(fragment.mesh);
      } else {
        for (const matID in data.geometriesByMaterial) {
          const id = data.instances[0].id;
          const category = this.splitByCategory ? this.state.models[modelID].types[id] : -1;
          if (!uniqueItems[category])
            uniqueItems[category] = {};
          const level = this.splitByFloors ? tree[id] : -1;
          if (!uniqueItems[category][level])
            uniqueItems[category][level] = {};
          if (!uniqueItems[category][level][matID])
            uniqueItems[category][level][matID] = [];
          const geometries = data.geometriesByMaterial[matID];
          const instance = data.instances[0];
          for (const geom of geometries) {
            geom.userData.id = id;
            uniqueItems[category][level][matID].push(geom);
            geom.applyMatrix4(instance.matrix);
          }
        }
      }
    }
    for (const categoryString in uniqueItems) {
      for (const levelString in uniqueItems[categoryString]) {
        const category = parseInt(categoryString);
        const level = parseInt(levelString);
        if (!level || !category)
          continue;
        const mats = Object.keys(uniqueItems[category][level]).map(id => this.materials[id]);
        const geometries = Object.values(uniqueItems[category][level]);
        let size = 0;
        const itemsIDs = new Set();
        for (const geometryGroup of geometries) {
          for (const geom of geometryGroup) {
            size += geom.attributes.position.count;
            itemsIDs.add(geom.userData.id);
          }
        }
        const buffer = new Uint32Array(size);
        const currentIDs = new Map();
        let offset = 0;
        let blockID = 0;
        for (const geometryGroup of geometries) {
          for (const geom of geometryGroup) {
            if (!currentIDs.has(geom.userData.id)) {
              currentIDs.set(geom.userData.id, blockID++);
            }
            const size = geom.attributes.position.count;
            const currentBlockID = currentIDs.get(geom.userData.id);
            buffer.fill(currentBlockID, offset, offset + size);
            offset += size;
          }
        }
        const merged = GeometryUtils.merge(geometries);
        merged.setAttribute('blockID', new BufferAttribute$1(buffer, 1));
        const mergedFragment = new Fragment(merged, mats, 1);
        const ids = Array. from (itemsIDs).map(id => id.toString());
        mergedFragment.setInstance(0, {
          ids,
          transform: new Matrix4()
        });
        model.fragments.push(mergedFragment);
        model.add(mergedFragment.mesh);
      }
    }
    model.levelRelationships = tree;
    model.allTypes = IfcTypesMap;
    model.itemTypes = this.state.models[modelID].types;
    model.floorsProperties = floorProperties;
    for (let data of fragmentsData) {
      data.geometriesByMaterial = null;
      data.instances = null;
      data.referenceMatrix = null;
    }
    this.items = {};
    this.materials = {};
    this.notifyLoadingEnded();
    this.state.models[this.currentModelID].mesh = model;
    return model;
  }

  async initializeLoadingState(modelID) {
    const shapes = await this.state.api.GetLineIDsWithType(modelID, IFCPRODUCTDEFINITIONSHAPE);
    this.loadingState.total = shapes.size();
    this.loadingState.current = 0;
    this.loadingState.step = 0.1;
  }

  notifyLoadingEnded() {
    this.notifyProgress(this.loadingState.total, this.loadingState.total);
  }

  updateLoadingState() {
    const realCurrentItem = Math.min(this.loadingState.current++, this.loadingState.total);
    if (realCurrentItem / this.loadingState.total >= this.loadingState.step) {
      const currentProgress = Math.ceil(this.loadingState.total * this.loadingState.step);
      this.notifyProgress(currentProgress, this.loadingState.total);
      this.loadingState.step += 0.1;
    }
  }

  addOptionalCategories(modelID) {
    const optionalTypes = [];
    for (let key in this.optionalCategories) {
      if (this.optionalCategories.hasOwnProperty(key)) {
        const category = parseInt(key);
        if (this.optionalCategories[category]) {
          optionalTypes.push(category);
        }
      }
    }
    this.state.api.StreamAllMeshesWithTypes(this.currentWebIfcID, optionalTypes, (mesh) => {
      this.streamMesh(modelID, mesh);
    });
  }

  streamMesh(modelID, mesh) {
    const placedGeometries = mesh.geometries;
    const size = placedGeometries.size();
    let geometryID = '';
    let referenceMatrix = new Matrix4();
    let isFirstMatrix = true;
    const geoms = {};
    for (let i = 0; i < size; i++) {
      const placedGeometry = placedGeometries.get(i);
      geometryID += placedGeometry.geometryExpressID;
    }
    if (!this.items[geometryID]) {
      for (let i = 0; i < size; i++) {
        const placedGeometry = placedGeometries.get(i);
        const geom = this.getBufferGeometry(modelID, placedGeometry);
        if (!geom) {
          return;
        }
        const matrix = this.getMeshMatrix(placedGeometry.flatTransformation);
        geom.applyMatrix4(matrix);
        if (isFirstMatrix) {
          const inverse = new Matrix4().copy(matrix).invert();
          referenceMatrix = inverse;
          isFirstMatrix = false;
        }
        const color = placedGeometry.color;
        const colorID = `${color.x}${color.y}${color.z}${color.w}`;
        if (!this.materials[colorID]) {
          this.materials[colorID] = new MeshLambertMaterial({
            color: new Color$1(color.x, color.y, color.z),
            transparent: color.w !== 1,
            opacity: color.w
          });
        }
        if (!geoms[colorID]) {
          geoms[colorID] = [geom];
        } else {
          geoms[colorID].push(geom);
        }
      }
      this.items[geometryID] = {
        instances: [{
          id: mesh.expressID,
          matrix: new Matrix4(),
        }],
        geometriesByMaterial: geoms,
        referenceMatrix
      };
    } else {
      const referenceMatrix = this.items[geometryID].referenceMatrix;
      const placedGeometry = placedGeometries.get(0);
      const transform = this.getMeshMatrix(placedGeometry.flatTransformation);
      transform.multiply(referenceMatrix);
      this.items[geometryID].instances.push({
        id: mesh.expressID,
        matrix: transform
      });
    }
  }

  getBufferGeometry(modelID, placedGeometry) {
    const geometry = this.state.api.GetGeometry(modelID, placedGeometry.geometryExpressID);
    const verts = this.state.api.GetVertexArray(geometry.GetVertexData(), geometry.GetVertexDataSize());
    if (!verts.length)
      return null;
    const indices = this.state.api.GetIndexArray(geometry.GetIndexData(), geometry.GetIndexDataSize());
    if (!indices.length)
      return null;
    const buffer = this.ifcGeometryToBuffer(verts, indices);
    geometry.delete();
    return buffer;
  }

  getMeshMatrix(matrix) {
    const mat = new Matrix4();
    mat.fromArray(matrix);
    return mat;
  }

  ifcGeometryToBuffer(vertexData, indexData) {
    const geometry = new BufferGeometry();
    const posFloats = new Float32Array(vertexData.length / 2);
    const normFloats = new Float32Array(vertexData.length / 2);
    for (let i = 0; i < vertexData.length; i += 6) {
      posFloats[i / 2] = vertexData[i];
      posFloats[i / 2 + 1] = vertexData[i + 1];
      posFloats[i / 2 + 2] = vertexData[i + 2];
      normFloats[i / 2] = vertexData[i + 3];
      normFloats[i / 2 + 1] = vertexData[i + 4];
      normFloats[i / 2 + 2] = vertexData[i + 5];
    }
    geometry.setAttribute('position', new BufferAttribute$1(posFloats, 3));
    geometry.setAttribute('normal', new BufferAttribute$1(normFloats, 3));
    geometry.setIndex(new BufferAttribute$1(indexData, 1));
    return geometry;
  }

}

class IFCManager {

  constructor() {
    this.state = {
      models: [],
      api: new WebIFC.IfcAPI(),
      useJSON: false,
      worker: {
        active: false,
        path: ''
      }
    };
    this.BVH = new BvhManager();
    this.typesMap = IfcTypesMap;
    this.parser = new IFCParser(this.state, this.BVH);
    this.subsets = new SubsetManager(this.state, this.BVH);
    this.utils = new IFCUtils(this.state);
    this.sequenceData = new Data(this.state);
    this.properties = new PropertyManager(this.state);
    this.types = new TypeManager(this.state);
    this.fragments = new FragmentParser(this.state, this.properties, this.types, this.BVH);
    this.useFragments = false;
    this.cleaner = new MemoryCleaner(this.state);
  }

  get ifcAPI() {
    return this.state.api;
  }

  async parse(buffer) {
    var _a,
      _b;
    let model;
    if (this.useFragments) {
      model = await this.fragments.parse(buffer, (_a = this.state.coordinationMatrix) === null || _a === void 0 ? void 0 : _a.toArray());
    } else {
      model = await this.parser.parse(buffer, (_b = this.state.coordinationMatrix) === null || _b === void 0 ? void 0 : _b.toArray());
    }
    model.setIFCManager(this);
    await this.types.getAllTypes(this.worker);
    return model;
  }

  async setWasmPath(path) {
    this.state.api.SetWasmPath(path);
    this.state.wasmPath = path;
  }

  setupThreeMeshBVH(computeBoundsTree, disposeBoundsTree, acceleratedRaycast) {
    this.BVH.initializeMeshBVH(computeBoundsTree, disposeBoundsTree, acceleratedRaycast);
  }

  setOnProgress(onProgress) {
    this.state.onProgress = onProgress;
  }

  setupCoordinationMatrix(matrix) {
    this.state.coordinationMatrix = matrix;
  }

  clearCoordinationMatrix() {
    delete this.state.coordinationMatrix;
  }

  async applyWebIfcConfig(settings) {
    this.state.webIfcSettings = settings;
    if (this.state.worker.active && this.worker) {
      await this.worker.workerState.updateStateWebIfcSettings();
    }
  }

  async useWebWorkers(active, path) {
    if (this.state.worker.active === active)
      return;
    this.state.api = null;
    if (active) {
      if (!path)
        throw new Error('You must provide a path to the web worker.');
      this.state.worker.active = active;
      this.state.worker.path = path;
      await this.initializeWorkers();
      const wasm = this.state.wasmPath;
      if (wasm)
        await this.setWasmPath(wasm);
    } else {
      this.state.api = new WebIFC.IfcAPI();
    }
  }

  async useJSONData(useJSON = true) {
    var _a;
    this.state.useJSON = useJSON;
    if (useJSON) {
      await ((_a = this.worker) === null || _a === void 0 ? void 0 : _a.workerState.updateStateUseJson());
    }
  }

  async addModelJSONData(modelID, data) {
    var _a;
    const model = this.state.models[modelID];
    if (!model)
      throw new Error('The specified model for the JSON data does not exist');
    if (this.state.worker.active) {
      await ((_a = this.worker) === null || _a === void 0 ? void 0 : _a.workerState.updateModelStateJsonData(modelID, data));
    } else {
      model.jsonData = data;
    }
  }

  async loadJsonDataFromWorker(modelID, path) {
    var _a;
    if (this.state.worker.active) {
      await ((_a = this.worker) === null || _a === void 0 ? void 0 : _a.workerState.loadJsonDataFromWorker(modelID, path));
    }
  }

  close(modelID, scene) {
    this.state.api.CloseModel(modelID);
    if (scene)
      scene.remove(this.state.models[modelID].mesh);
    delete this.state.models[modelID];
  }

  getExpressId(geometry, faceIndex) {
    return this.properties.getExpressId(geometry, faceIndex);
  }

  getAllItemsOfType(modelID, type, verbose) {
    return this.properties.getAllItemsOfType(modelID, type, verbose);
  }

  getItemProperties(modelID, id, recursive = false) {
    return this.properties.getItemProperties(modelID, id, recursive);
  }

  getPropertySets(modelID, id, recursive = false) {
    return this.properties.getPropertySets(modelID, id, recursive);
  }

  getTypeProperties(modelID, id, recursive = false) {
    return this.properties.getTypeProperties(modelID, id, recursive);
  }

  getMaterialsProperties(modelID, id, recursive = false) {
    return this.properties.getMaterialsProperties(modelID, id, recursive);
  }

  getIfcType(modelID, id) {
    const typeID = this.state.models[modelID].types[id];
    return IfcElements[typeID];
  }

  getSpatialStructure(modelID, includeProperties) {
    return this.properties.getSpatialStructure(modelID, includeProperties);
  }

  getSubset(modelID, material, customId) {
    return this.subsets.getSubset(modelID, material, customId);
  }

  removeSubset(modelID, material, customID) {
    this.subsets.removeSubset(modelID, material, customID);
  }

  createSubset(config) {
    return this.subsets.createSubset(config);
  }

  removeFromSubset(modelID, ids, customID, material) {
    return this.subsets.removeFromSubset(modelID, ids, customID, material);
  }

  clearSubset(modelID, customID, material) {
    return this.subsets.clearSubset(modelID, customID, material);
  }

  async isA(entity, entity_class) {
    return this.utils.isA(entity, entity_class);
  }

  async getSequenceData(modelID) {
    await this.sequenceData.load(modelID);
    return this.sequenceData;
  }

  async byType(modelID, entityClass) {
    return this.utils.byType(modelID, entityClass);
  }

  async byId(modelID, id) {
    return this.utils.byId(modelID, id);
  }

  async idsByType(modelID, entityClass) {
    return this.utils.idsByType(modelID, entityClass);
  }

  async dispose() {
    IFCModel.dispose();
    await this.cleaner.dispose();
    this.subsets.dispose();
    if (this.worker && this.state.worker.active)
      await this.worker.terminate();
    this.state = null;
  }

  async disposeMemory() {
    var _a;
    if (this.state.worker.active) {
      await ((_a = this.worker) === null || _a === void 0 ? void 0 : _a.Close());
    } else {
      this.state.api.Close();
      this.state.api = null;
      this.state.api = new WebIFC.IfcAPI();
    }
  }

  getAndClearErrors(modelID) {
    return this.parser.getAndClearErrors(modelID);
  }

  async initializeWorkers() {
    this.worker = new IFCWorkerHandler(this.state, this.BVH);
    this.state.api = this.worker.webIfc;
    this.properties = this.worker.properties;
    await this.worker.parser.setupOptionalCategories(this.parser.optionalCategories);
    this.parser = this.worker.parser;
    await this.worker.workerState.updateStateUseJson();
    await this.worker.workerState.updateStateWebIfcSettings();
  }

}

class IFCLoader extends Loader {

  constructor(manager) {
    super(manager);
    this.ifcManager = new IFCManager();
  }

  load(url, onLoad, onProgress, onError) {
    const scope = this;
    const loader = new FileLoader(scope.manager);
    this.onProgress = onProgress;
    loader.setPath(scope.path);
    loader.setResponseType('arraybuffer');
    loader.setRequestHeader(scope.requestHeader);
    loader.setWithCredentials(scope.withCredentials);
    loader.load(url, async function (buffer) {
      try {
        if (typeof buffer == 'string') {
          throw new Error('IFC files must be given as a buffer!');
        }
        onLoad(await scope.parse(buffer));
      } catch (e) {
        if (onError) {
          onError(e);
        } else {
          console.error(e);
        }
        scope.manager.itemError(url);
      }
    }, onProgress, onError);
  }

  parse(buffer) {
    return this.ifcManager.parse(buffer);
  }

}

export { IFCLoader };
//# sourceMappingURL=IFCLoader.js.map
